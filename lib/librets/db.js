/**
 * Module dependencies.
 * @ignore
 */
var QueryCommand = require('./commands/query_command').QueryCommand
  , DbCommand = require('./commands/db_command').DbCommand
  , Collection = require('./collection').Collection
  , Server = require('./connection/server').Server
  , EventEmitter = require('events').EventEmitter
  , inherits = require('util').inherits
  , crypto = require('crypto')
  , timers = require('timers')
  , utils = require('./utils');
  
var hasKerberos = false;
// Check if we have a the kerberos library
try {
  require('kerberos');
  hasKerberos = true;
} catch(err) {}

// Set processor, setImmediate if 0.10 otherwise nextTick
var processor = require('./utils').processor();

/**
 * Create a new Db instance.
 *
 * Options
 *  - **w**, {Number/String, > -1 || 'majority' || tag name} the write concern for the operation where < 1 is no acknowledgement of write and w >= 1, w = 'majority' or tag acknowledges the write
 *  - **wtimeout**, {Number, 0} set the timeout for waiting for write concern to finish (combines with w option)
 *  - **native_parser** {Boolean, default:false}, use c++ bson parser.
 *  - **pkFactory** {Object}, object overriding the basic ObjectID primary key generation.
 *  - **serializeFunctions** {Boolean, default:false}, serialize functions.
 *  - **raw** {Boolean, default:false}, perform operations using raw bson buffers.
 *  - **recordQueryStats** {Boolean, default:false}, record query statistics during execution.
 *  - **retryMiliSeconds** {Number, default:5000}, number of milliseconds between retries.
 *  - **numberOfRetries** {Number, default:5}, number of retries off connection.
 *  - **logger** {Object, default:null}, an object representing a logger that you want to use, needs to support functions debug, log, error **({error:function(message, object) {}, log:function(message, object) {}, debug:function(message, object) {}})**.
 *  - **slaveOk** {Number, default:null}, force setting of SlaveOk flag on queries (only use when explicitly connecting to a secondary server).
 *  - **promoteLongs** {Boolean, default:true}, when deserializing a Long will fit it into a Number if it's smaller than 53 bits
 *  - **bufferMaxEntries** {Boolean, default: -1}, sets a cap on how many operations the driver will buffer up before giving up on getting a working connection, default is -1 which is unlimited
 * 
 * @class Represents a Db
 * @param {Object} serverConfig server config object.
 * @param {Object} [options] additional options for the collection.
 */
function Db(serverConfig, options) {
  if(!(this instanceof Db)) return new Db(serverConfig, options);
  EventEmitter.call(this);
  var self = this;
  this.serverConfig = serverConfig;
  this.options = options == null ? {} : options;
  // State to check against if the user force closed db
  this._applicationClosed = false;
  // Fetch the override flag if any
  var overrideUsedFlag = this.options['override_used_flag'] == null ? false : this.options['override_used_flag'];

  // Verify that nobody is using this config
  if(!overrideUsedFlag && this.serverConfig != null && typeof this.serverConfig == 'object' && this.serverConfig._isUsed && this.serverConfig._isUsed()) {    
    throw new Error('A Server instance cannot be shared across multiple Db instances');
  } else if(!overrideUsedFlag && typeof this.serverConfig == 'object'){
    // Set being used
    this.serverConfig._used = true;
  }

  // Allow slaveOk override
  this.slaveOk = this.options['slave_ok'] == null ? false : this.options['slave_ok'];
  this.slaveOk = this.options['slaveOk'] == null ? this.slaveOk : this.options['slaveOk'];
  
  // Number of operations to buffer before failure
  this.bufferMaxEntries = typeof this.options['bufferMaxEntries'] == 'number' ? this.options['bufferMaxEntries'] : -1;

  // Contains all the connections for the db
  try {
    this.native_parser = this.options.native_parser;
    // The bson lib
    var bsonLib = this.bsonLib = this.options.native_parser ? require('bson').BSONNative : require('bson').BSONPure;
    // Fetch the serializer object
    var BSON = bsonLib.BSON;
    
    // Create a new instance
    this.bson = new BSON([bsonLib.Long, bsonLib.ObjectID, bsonLib.Binary, bsonLib.Code, bsonLib.DBRef, bsonLib.Symbol, bsonLib.Double, bsonLib.Timestamp, bsonLib.MaxKey, bsonLib.MinKey]);
    this.bson.promoteLongs = this.options.promoteLongs == null ? true : this.options.promoteLongs;
    
    // Backward compatibility to access types
    this.bson_deserializer = bsonLib;
    this.bson_serializer = bsonLib;
    
    // Add any overrides to the serializer and deserializer
    this.bson_deserializer.promoteLongs = this.options.promoteLongs == null ? true : this.options.promoteLongs;
  } catch (err) {
    // If we tried to instantiate the native driver
    var msg = 'Native bson parser not compiled, please compile '
            + 'or avoid using native_parser=true';
    throw Error(msg);
  }

  // Internal state of the server
  this._state = 'disconnected';

  this.pkFactory = this.options.pk == null ? bsonLib.ObjectID : this.options.pk;

  // Internal states variables
  this.notReplied ={};
  this.isInitializing = true;
  this.openCalled = false;

  // Command queue, keeps a list of incoming commands that need to be executed once the connection is up
  this.commands = [];

  // Set up logger
  this.logger = this.options.logger != null
    && (typeof this.options.logger.debug == 'function')
    && (typeof this.options.logger.error == 'function')
    && (typeof this.options.logger.log == 'function')
      ? this.options.logger : {error:function(message, object) {}, log:function(message, object) {}, debug:function(message, object) {}};

  // Associate the logger with the server config
  this.serverConfig.logger = this.logger;
  if(this.serverConfig.strategyInstance) this.serverConfig.strategyInstance.logger = this.logger;
  this.tag = new Date().getTime();
  // Just keeps list of events we allow
  this.eventHandlers = {error:[], parseError:[], poolReady:[], message:[], close:[]};

  // Controls serialization options
  this.serializeFunctions = this.options.serializeFunctions != null ? this.options.serializeFunctions : false;

  // Raw mode
  this.raw = this.options.raw != null ? this.options.raw : false;

  // Record query stats
  this.recordQueryStats = this.options.recordQueryStats != null ? this.options.recordQueryStats : false;

  // If we have server stats let's make sure the driver objects have it enabled
  if(this.recordQueryStats == true) {
    this.serverConfig.enableRecordQueryStats(true);
  }

  // Retry information
  this.retryMiliSeconds = this.options.retryMiliSeconds != null ? this.options.retryMiliSeconds : 1000;
  this.numberOfRetries = this.options.numberOfRetries != null ? this.options.numberOfRetries : 60;

  // Ensure we keep a reference to this db
  this.serverConfig._dbStore.add(this);
};

/**
 * @ignore
 */
inherits(Db, EventEmitter);

/**
 * Initialize the database connection.
 *
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the index information or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.open = function(callback) {
  var self = this;

  // Check that the user has not called this twice
  if(this.openCalled) {
    // Close db
    this.close();
    // Throw error
    throw new Error("db object already connecting, open cannot be called multiple times");
  }

  // Set that db has been opened
  this.openCalled = true;

  // Set the status of the server
  self._state = 'connecting';
  
  // Set up connections
  if(self.serverConfig instanceof Server) {
    // Ensure we have the original options passed in for the server config
    var connect_options = {};
    for(var name in self.serverConfig.options) {
      connect_options[name] = self.serverConfig.options[name]
    }
    connect_options.firstCall = true;

    // Attempt to connect
    self.serverConfig.connect(self, connect_options, function(err, result) {
      if(err != null) {
        // Close db to reset connection
        return self.close(function () {
          // Return error from connection
          return callback(err, null);
        });
      }
      // Set the status of the server
      self._state = 'connected';
      // If we have queued up commands execute a command to trigger replays
      if(self.commands.length > 0) _execute_queued_command(self);
      // Callback
      process.nextTick(function() {
        try {
          callback(null, self);
        } catch(err) {
          self.close();
          throw err;
        }
      });
    });
  } else {
    try {
      callback(Error("Server parameter must be of type Server"), null);
    } catch(err) {
      self.close();
      throw err;
    }
  }
};

/**
 * Create a new Db instance sharing the current socket connections.
 *
 * @param {String} dbName the name of the database we want to use.
 * @return {Db} a db instance using the new database.
 * @api public
 */
Db.prototype.db = function(dbName) {
  // Copy the options and add out internal override of the not shared flag
  var options = {};
  for(var key in this.options) {
    options[key] = this.options[key];
  }

  // Add override flag
  options['override_used_flag'] = true;
  // Check if the db already exists and reuse if it's the case
  var db = this.serverConfig._dbStore.fetch(dbName);

  // Create a new instance
  if(!db) {
    db = new Db(dbName, this.serverConfig, options);
  }

  // Return the db object
  return db;  
};

/**
 * Close the current db connection, including all the child db instances. Emits close event if no callback is provided.
 *
 * @param {Boolean} [forceClose] connection can never be reused.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.close = function(forceClose, callback) {
  var self = this;
  // Ensure we force close all connections
  this._applicationClosed = false;

  if(typeof forceClose == 'function') {
    callback = forceClose;
  } else if(typeof forceClose == 'boolean') {
    this._applicationClosed = forceClose;
  }

  this.serverConfig.close(function(err, result) {
    // You can reuse the db as everything is shut down
    self.openCalled = false;
    // If we have a callback call it
    if(callback) callback(err, result);    
  });
};

/**
 * Logout user from server, fire off on all connections and remove all auth info
 *
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results from logout or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.logout = function(options, callback) {
  var self = this;
  // Unpack calls
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  options = args.length ? args.shift() || {} : {};

  // Number of connections we need to logout from
  var numberOfConnections = this.serverConfig.allRawConnections().length;

  // Let's generate the logout command object
  var logoutCommand = DbCommand.logoutCommand(self, {logout:1}, options);
  self._executeQueryCommand(logoutCommand, {onAll:true}, function(err, result) {
    // Count down
    numberOfConnections = numberOfConnections - 1;
    // Work around the case where the number of connections are 0
    if(numberOfConnections <= 0 && typeof callback == 'function') {
      var internalCallback = callback;
      callback = null;

      // Handle error result
      utils.handleSingleCommandResultReturn(true, false, internalCallback)(err, result);
    }
  });
};

/**
 * Authenticate a user against the server.
 * authMechanism
 * Options
 *  - **authMechanism** {String, default:DIGEST}, The authentication mechanism to use, BASIC, OAUTH or DIGEST 
 *
 * @param {String} username username.
 * @param {String} password password.
 * @param {Object} [options] the options
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results from authentication or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.authenticate = function(username, password, options, callback) {
  var self = this;

  if(typeof options == 'function') {
    callback = options;
    options = {};
  }

  // Set default mechanism
  if(!options.authMechanism) {
    options.authMechanism = 'DIGEST';
  } else if(options.authMechanism != 'BASIC' 
    && options.authMechanism != 'OAUTH'
    && options.authMechanism != 'DIGEST') {
      return callback(new Error("only BASIC, OAUTH or DIGEST is supported by authMechanism"));
  }

  // Callback
  var _callback = function(err, result) {
    if(self.listeners("authenticated").length > 9) {
      self.emit("authenticated", err, result);
    }

    // Return to caller
    callback(err, result);
  }

  callback(null, true);

};

/**
 * Return last error message for the given connection, note options can be combined.
 *
 * Options
 *  - **w** {Number}, until a write operation has been replicated to N servers.
 *  - **wtimeout** {Number}, number of miliseconds to wait before timing out.
 *
 * Connection Options
 *  - **connection** {Connection}, fire the getLastError down a specific connection.
 *
 * @param {Object} [options] returns option results.
 * @param {Object} [connectionOptions] returns option results.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results from lastError or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.lastError = function(options, connectionOptions, callback) {
  // Unpack calls
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  options = args.length ? args.shift() || {} : {};
  connectionOptions = args.length ? args.shift() || {} : {};

  this._executeQueryCommand(DbCommand.createGetLastErrorCommand(options, this), connectionOptions, function(err, error) {
    callback(err, error && error.documents);
  });
};

/**
 * Legacy method calls.
 *
 * @ignore
 * @api private
 */
Db.prototype.error = Db.prototype.lastError;
Db.prototype.lastStatus = Db.prototype.lastError;

/**
 * Return all errors up to the last time db reset_error_history was called.
 *
 * Options
 *  - **connection** {Connection}, fire the getLastError down a specific connection.
 *
 * @param {Object} [options] returns option results.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results from previousErrors or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.previousErrors = function(options, callback) {
  // Unpack calls
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  options = args.length ? args.shift() || {} : {};

  this._executeQueryCommand(DbCommand.createGetPreviousErrorsCommand(this), options, function(err, error) {
    callback(err, error.documents);
  });
};

/**
 * Runs a command on the database.
 * @ignore
 * @api private
 */
Db.prototype.executeDbCommand = function(command_hash, options, callback) {
  if(callback == null) { callback = options; options = {}; }
  this._executeQueryCommand(DbCommand.createDbSlaveOkCommand(this, command_hash, options), options, function(err, result) {
    if(callback) callback(err, result);
  });
};

/**
 * Resets the error history of the mongo instance.
 *
 * Options
 *  - **connection** {Connection}, fire the getLastError down a specific connection.
 *
 * @param {Object} [options] returns option results.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results from resetErrorHistory or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.resetErrorHistory = function(options, callback) {
  // Unpack calls
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  options = args.length ? args.shift() || {} : {};

  this._executeQueryCommand(DbCommand.createResetErrorHistoryCommand(this), options, function(err, error) {
    if(callback) callback(err, error && error.documents);
  });
};

/**
 * Get all the db statistics.
 *
 * Options
 *  - **scale** {Number}, divide the returned sizes by scale value.
 *
 * @param {Objects} [options] options for the stats command
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the results from stats or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.prototype.stats = function stats(options, callback) {
  var args = Array.prototype.slice.call(arguments, 0);
  callback = args.pop();
  // Fetch all commands
  options = args.length ? args.shift() || {} : {};

  // Build command object
  var commandObject = {
    dbStats:this.collectionName
  };

  // Check if we have the scale value
  if(options['scale'] != null) commandObject['scale'] = options['scale'];

  // Execute the command
  this.command(commandObject, options, callback);
}

/**
 * @ignore
 */
var __executeQueryCommand = function(self, db_command, options, callback) {
  // Options unpacking
  var read = options['read'] != null ? options['read'] : false;  
  var raw = options['raw'] != null ? options['raw'] : self.raw;
  var onAll = options['onAll'] != null ? options['onAll'] : false;
  var specifiedConnection = options['connection'] != null ? options['connection'] : null;

  // If we got a callback object
  if(typeof callback === 'function' && !onAll) {
    // Override connection if we passed in a specific connection
    var connection = specifiedConnection != null ? specifiedConnection : null;

    if(connection instanceof Error) return callback(connection, null);

    // Fetch either a reader or writer dependent on the specified read option if no connection
    // was passed in
    if(connection == null) {
      connection = self.serverConfig.checkoutReader(read);
    }

    if(connection == null) {
      return callback(new Error("no open connections"));
    } else if(connection instanceof Error || connection['message'] != null) {
      return callback(connection);
    }

    // Exhaust Option
    var exhaust = options.exhaust || false;
    
    // Register the handler in the data structure
    self.serverConfig._registerHandler(db_command, raw, connection, exhaust, callback);
    
    // Write the message out and handle any errors if there are any
    connection.write(db_command, function(err) {
      if(err != null) {
        // Call the handler with an error
        if(Array.isArray(db_command))
          self.serverConfig._callHandler(db_command[0].getRequestId(), null, err);
        else
          self.serverConfig._callHandler(db_command.getRequestId(), null, err);
      }
    });
  } else if(typeof callback === 'function' && onAll) {
    var connections = self.serverConfig.allRawConnections();
    var numberOfEntries = connections.length;
    // Go through all the connections
    for(var i = 0; i < connections.length; i++) {
      // Fetch a connection
      var connection = connections[i];

      // Ensure we have a valid connection
      if(connection == null) {
        return callback(new Error("no open connections"));
      } else if(connection instanceof Error) {
        return callback(connection);
      }

      // Register the handler in the data structure
      self.serverConfig._registerHandler(db_command, raw, connection, callback);

      // Write the message out
      connection.write(db_command, function(err) {
        // Adjust the number of entries we need to process
        numberOfEntries = numberOfEntries - 1;
        // Remove listener
        if(err != null) {
          // Clean up listener and return error
          self.serverConfig._removeHandler(db_command.getRequestId());
        }

        // No more entries to process callback with the error
        if(numberOfEntries <= 0) {
          callback(err);
        }
      });

      // Update the db_command request id
      db_command.updateRequestId();
    }
  } else {
    // Fetch either a reader or writer dependent on the specified read option
    // var connection = read == null || read == 'primary' || read == false ? self.serverConfig.checkoutWriter(true) : self.serverConfig.checkoutReader(read);
    var connection = self.serverConfig.checkoutReader(read);
    // Override connection if needed
    connection = specifiedConnection != null ? specifiedConnection : connection;
    // Ensure we have a valid connection
    if(connection == null || connection instanceof Error || connection['message'] != null) return null;
    // Write the message out
    connection.write(db_command, function(err) {
      if(err != null) {
        // Emit the error
        self.emit("error", err);
      }
    });
  }
};

/**
 * Execute db query command
 * @ignore
 * @api private
 */
Db.prototype._executeQueryCommand = function(db_command, options, callback) {
  var self = this;

  // Unpack the parameters
  if (typeof callback === 'undefined') {
    callback = options;
    options = {};
  }

  // fast fail option used for HA, no retry
  var failFast = options['failFast'] != null
    ? options['failFast']
    : false;

  // Check if the user force closed the command
  if(this._applicationClosed) {
    var err = new Error("db closed by application");
    if('function' == typeof callback) {
      return callback(err, null);
    } else {
      throw err;
    }
  }

  if(this.serverConfig.isDestroyed()) 
    return callback(new Error("Connection was destroyed by application"));

  // Specific connection
  var connection = options.connection;
  // Check if the connection is actually live
  if(connection 
    && (!connection.isConnected || !connection.isConnected())) connection = null;

  // Get the configuration
  var config = this.serverConfig;
  var read = options.read;

  if(!connection && !config.canRead(read) && !config.canWrite() && config.isAutoReconnect()) {
    if(read == ReadPreference.PRIMARY 
      || read == ReadPreference.PRIMARY_PREFERRED
      || (read != null && typeof read == 'object' && read.mode)
      || read == null) {
      
      // Save the command
      self.serverConfig._commandsStore.read_from_writer(
        {   type: 'query'
          , db_command: db_command
          , options: options
          , callback: callback
          , db: self
          , executeQueryCommand: __executeQueryCommand
          , executeInsertCommand: __executeInsertCommand
        }
      );
    } else {
      self.serverConfig._commandsStore.read(
        {   type: 'query'
          , db_command: db_command
          , options: options
          , callback: callback 
          , db: self
          , executeQueryCommand: __executeQueryCommand
          , executeInsertCommand: __executeInsertCommand
        }
      );
    }

    // If we have blown through the number of items let's 
    if(!self.serverConfig._commandsStore.validateBufferLimit(self.bufferMaxEntries)) {
      self.close();
    }    
  } else if(!connection && !config.canRead(read) && !config.canWrite() && !config.isAutoReconnect()) {
    return callback(new Error("no open connections"), null);
  } else {
    if(typeof callback == 'function') {
      __executeQueryCommand(self, db_command, options, function (err, result, conn) {
        callback(err, result, conn);
      });          
    } else {
      __executeQueryCommand(self, db_command, options);
    }
  }
};

/**
 * @ignore
 */
var __executeInsertCommand = function(self, db_command, options, callback) {
  // Always checkout a writer for this kind of operations
  var connection = self.serverConfig.checkoutWriter();
  var raw = options['raw'] != null ? options['raw'] : self.raw;
  var specifiedConnection = options['connection'] != null ? options['connection'] : null;
  // Override connection if needed
  connection = specifiedConnection != null ? specifiedConnection : connection;

  // Validate if we can use this server 2.6 wire protocol
  if(!connection.isCompatible()) {
    return callback(utils.toError("driver is incompatible with this server version"), null);
  }

  // Ensure we have a valid connection
  if(typeof callback === 'function') {
    // Ensure we have a valid connection
    if(connection == null) {
      return callback(new Error("no open connections"));
    } else if(connection instanceof Error) {
      return callback(connection);
    }

    var errorOptions = _getWriteConcern(self, options);
    if(errorOptions.w > 0 || errorOptions.w == 'majority' || errorOptions.j) {      
      // db command is now an array of commands (original command + lastError)
      db_command = [db_command, DbCommand.createGetLastErrorCommand(self)];
      // Register the handler in the data structure
      self.serverConfig._registerHandler(db_command[1], raw, connection, callback);      
    }
  }

  // If we have no callback and there is no connection
  if(connection == null) return null;
  if(connection instanceof Error && typeof callback == 'function') return callback(connection, null);
  if(connection instanceof Error) return null;
  if(connection == null && typeof callback == 'function') return callback(new Error("no primary server found"), null);

  // Write the message out
  connection.write(db_command, function(err) {
    if(typeof callback === 'function') {
      // Call the handler with an error
      self.serverConfig._callHandler(db_command[1].getRequestId(), null, err);
    }
  });
};

/**
 * Execute an insert Command
 * @ignore
 * @api private
 */
Db.prototype._executeInsertCommand = function(db_command, options, callback) {
  var self = this;

  // Unpack the parameters
  if(callback == null && typeof options === 'function') {
    callback = options;
    options = {};
  }

  // Ensure options are not null
  options = options == null ? {} : options;

  // Check if the user force closed the command
  if(this._applicationClosed) {
    if(typeof callback == 'function') {
      return callback(new Error("db closed by application"), null);
    } else {
      throw new Error("db closed by application");
    }
  }

  if(this.serverConfig.isDestroyed()) return callback(new Error("Connection was destroyed by application"));

  // Specific connection
  var connection = options.connection;
  // Check if the connection is actually live
  if(connection 
    && (!connection.isConnected || !connection.isConnected())) connection = null;

  // Get config
  var config = self.serverConfig;
  // Check if we are connected
  if(!connection && !config.canWrite() && config.isAutoReconnect()) {
    self.serverConfig._commandsStore.write(
      {   type:'insert'
        , 'db_command':db_command
        , 'options':options
        , 'callback':callback
        , db: self
        , executeQueryCommand: __executeQueryCommand
        , executeInsertCommand: __executeInsertCommand
      }
    );

    // If we have blown through the number of items let's 
    if(!self.serverConfig._commandsStore.validateBufferLimit(self.bufferMaxEntries)) {
      self.close();
    }        
  } else if(!connection && !config.canWrite() && !config.isAutoReconnect()) {
    return callback(new Error("no open connections"), null);
  } else {
    __executeInsertCommand(self, db_command, options, callback);
  }
};

/**
 * Update command is the same
 * @ignore
 * @api private
 */
Db.prototype._executeUpdateCommand = Db.prototype._executeInsertCommand;
/**
 * Remove command is the same
 * @ignore
 * @api private
 */
Db.prototype._executeRemoveCommand = Db.prototype._executeInsertCommand;

/**
 * Wrap a Mongo error document into an Error instance.
 * Deprecated. Use utils.toError instead.
 *
 * @ignore
 * @api private
 * @deprecated
 */
Db.prototype.wrap = utils.toError;

/**
 * Default URL
 *
 * @classconstant DEFAULT_URL
 **/
Db.DEFAULT_URL = 'https://localhost:6103';

/**
 * Connect with libRETS using a url as documented at
 *
 *  docs.mongodb.org/manual/reference/connection-string/
 *
 * Options
 *  - **uri_decode_auth** {Boolean, default:false} uri decode the user name and password for authentication
 *  - **db** {Object, default: null} a hash off options to set on the db object, see **Db constructor**
 *  - **server** {Object, default: null} a hash off options to set on the server objects, see **Server** constructor**
 *
 * @param {String} url connection url for libRETS.
 * @param {Object} [options] optional options for insert command
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occurred, or null otherwise. While the second parameter will contain the db instance or null if an error occurred.
 * @return {null}
 * @api public
 */
Db.connect = function(url, options, callback) {
  // Ensure correct mapping of the callback
  if(typeof options == 'function') {
    callback = options;
    options = {};
  }

};

/**
 * State of the db connection
 * @ignore
 */
Object.defineProperty(Db.prototype, "state", { enumerable: true
  , get: function () {
      return this.serverConfig._serverState;
    }
});

/**
 * @ignore
 */
var _hasWriteConcern = function(errorOptions) {
  return errorOptions == true
    || errorOptions.w > 0
    || errorOptions.w == 'majority'
    || errorOptions.j == true
};

/**
 * @ignore
 */
var _setWriteConcernHash = function(options) {
  var finalOptions = {};
  if(options.w != null) finalOptions.w = options.w;  
  if(options.j == true) finalOptions.j = options.j;
  if(options.wtimeout != null) finalOptions.wtimeout = options.wtimeout;  
  return finalOptions;
};

/**
 * @ignore
 */
var _getWriteConcern = function(self, options, callback) {
  // Final options
  var finalOptions = {w:1};
  // Local options verification
  if(options.w != null || typeof options.j == 'boolean') {
    finalOptions = _setWriteConcernHash(options);
  } else if(self.options.w != null || typeof self.options.j == 'boolean') {
    finalOptions = _setWriteConcernHash(self.options);
  }

  // Return the options
  return finalOptions;
};

/**
 * Legacy support
 *
 * @ignore
 * @api private
 */
exports.connect = Db.connect;
exports.Db = Db;

/**
 * Remove all listeners to the db instance.
 * @ignore
 * @api private
 */
Db.prototype.removeAllEventListeners = function() {
  this.removeAllListeners("close");
  this.removeAllListeners("error");
  this.removeAllListeners("timeout");
  this.removeAllListeners("parseError");
  this.removeAllListeners("poolReady");
  this.removeAllListeners("message");
};
