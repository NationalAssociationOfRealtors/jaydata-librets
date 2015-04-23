/**
 * Module dependencies.
 * @ignore
 */
var QueryCommand = require('./commands/query_command').QueryCommand
  , DbCommand = require('./commands/db_command').DbCommand
  , ObjectID = require('bson').ObjectID
  , Code = require('bson').Code
  , utils = require('./utils')
  , shared = require('./collection/shared')
  , query = require('./collection/query')
  , index = require('./collection/index')
  , commands = require('./collection/commands');

/**
 * Create a new Collection instance (INTERNAL TYPE, do not instantiate directly)
 *
 * Options
 *  - **readPreference** {String}, the prefered read preference (ReadPreference.PRIMARY, ReadPreference.PRIMARY_PREFERRED, ReadPreference.SECONDARY, ReadPreference.SECONDARY_PREFERRED, ReadPreference.NEAREST).
 *  - **slaveOk** {Boolean, default:false}, Allow reads from secondaries.
 *  - **serializeFunctions** {Boolean, default:false}, serialize functions on the document.
 *  - **raw** {Boolean, default:false}, perform all operations using raw bson objects.
 *  - **pkFactory** {Object}, object overriding the basic ObjectID primary key generation.
 *
 * @class Represents a Collection
 * @param {Object} db db instance.
 * @param {String} collectionName collection name.
 * @param {Object} [pkFactory] alternative primary key factory.
 * @param {Object} [options] additional options for the collection.
 * @return {Object} a collection instance.
 */
function Collection (db, collectionName, pkFactory, options) {
  if(!(this instanceof Collection)) return new Collection(db, collectionName, pkFactory, options);

  shared.checkCollectionName(collectionName);

  this.db = db;
  this.collectionName = collectionName;
  this.internalHint = null;
  this.opts = options != null && ('object' === typeof options) ? options : {};
  this.slaveOk = options == null || options.slaveOk == null ? db.slaveOk : options.slaveOk;
  this.serializeFunctions = options == null || options.serializeFunctions == null ? db.serializeFunctions : options.serializeFunctions;
  this.raw = options == null || options.raw == null ? db.raw : options.raw;

  this.readPreference = options == null || options.readPreference == null ? db.serverConfig.options.readPreference : options.readPreference;
  this.readPreference = this.readPreference == null ? 'primary' : this.readPreference;


  this.pkFactory = pkFactory == null
    ? ObjectID
    : pkFactory;

  // Server Capabilities
  this.serverCapabilities = this.db.serverConfig._serverCapabilities;
}

/**
 * Count number of matching documents in the db to a query.
 *
 * Options
 *  - **skip** {Number}, The number of documents to skip for the count.
 *  - **limit** {Number}, The limit of documents to count.
 *  - **readPreference** {String}, the preferred read preference, require('mongodb').ReadPreference (ReadPreference.PRIMARY, ReadPreference.PRIMARY_PREFERRED, ReadPreference.SECONDARY, ReadPreference.SECONDARY_PREFERRED, ReadPreference.NEAREST).
 *
 * @param {Object} [query] query to filter by before performing count.
 * @param {Object} [options] additional options during count.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occured, or null otherwise. While the second parameter will contain the results from the count method or null if an error occured.
 * @return {null}
 * @api public
 */
Collection.prototype.count = function() { return commands.count; }();

/**
 * Creates a cursor for a query that can be used to iterate over results from MongoDB
 *
 * Various argument possibilities
 *  - callback?
 *  - selector, callback?,
 *  - selector, fields, callback?
 *  - selector, options, callback?
 *  - selector, fields, options, callback?
 *  - selector, fields, skip, limit, callback?
 *  - selector, fields, skip, limit, timeout, callback?
 *
 * Options
 *  - **limit** {Number, default:0}, sets the limit of documents returned in the query.
 *  - **sort** {Array | Object}, set to sort the documents coming back from the query. Array of indexes, [['a', 1]] etc.
 *  - **fields** {Object}, the fields to return in the query. Object of fields to include or exclude (not both), {'a':1}
 *  - **skip** {Number, default:0}, set to skip N documents ahead in your query (useful for pagination).
 *  - **hint** {Object}, tell the query to use specific indexes in the query. Object of indexes to use, {'_id':1}
 *  - **explain** {Boolean, default:false}, explain the query instead of returning the data.
 *  - **snapshot** {Boolean, default:false}, snapshot query.
 *  - **timeout** {Boolean, default:false}, specify if the cursor can timeout.
 *  - **tailable** {Boolean, default:false}, specify if the cursor is tailable.
 *  - **tailableRetryInterval** {Number, default:100}, specify the miliseconds between getMores on tailable cursor.
 *  - **numberOfRetries** {Number, default:5}, specify the number of times to retry the tailable cursor.
 *  - **awaitdata** {Boolean, default:false} allow the cursor to wait for data, only applicable for tailable cursor.
 *  - **oplogReplay** {Boolean, default:false} sets an internal flag, only applicable for tailable cursor.
 *  - **exhaust** {Boolean, default:false} have the server send all the documents at once as getMore packets, not recommended.
 *  - **batchSize** {Number, default:0}, set the batchSize for the getMoreCommand when iterating over the query results.
 *  - **returnKey** {Boolean, default:false}, only return the index key.
 *  - **maxScan** {Number}, Limit the number of items to scan.
 *  - **min** {Number}, Set index bounds.
 *  - **max** {Number}, Set index bounds.
 *  - **showDiskLoc** {Boolean, default:false}, Show disk location of results.
 *  - **comment** {String}, You can put a $comment field on a query to make looking in the profiler logs simpler.
 *  - **raw** {Boolean, default:false}, Return all BSON documents as Raw Buffer documents.
 *  - **readPreference** {String}, the preferred read preference, require('mongodb').ReadPreference ((ReadPreference.PRIMARY, ReadPreference.PRIMARY_PREFERRED, ReadPreference.SECONDARY, ReadPreference.SECONDARY_PREFERRED, ReadPreference.NEAREST).
 *  - **numberOfRetries** {Number, default:5}, if using awaidata specifies the number of times to retry on timeout.
 *  - **partial** {Boolean, default:false}, specify if the cursor should return partial results when querying against a sharded system
 *
 * @param {Object|ObjectID} query query object to locate the object to modify
 * @param {Object} [options] additional options during update.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occured, or null otherwise. While the second parameter will contain the results from the find method or null if an error occured.
 * @return {Cursor} returns a cursor to the query
 * @api public
 */
Collection.prototype.find = function() { return query.find; }();

/**
 * Finds a single document based on the query
 *
 * Various argument possibilities
 *  - callback?
 *  - selector, callback?,
 *  - selector, fields, callback?
 *  - selector, options, callback?
 *  - selector, fields, options, callback?
 *  - selector, fields, skip, limit, callback?
 *  - selector, fields, skip, limit, timeout, callback?
 *
 * Options
 *  - **limit** {Number, default:0}, sets the limit of documents returned in the query.
 *  - **sort** {Array | Object}, set to sort the documents coming back from the query. Array of indexes, [['a', 1]] etc.
 *  - **fields** {Object}, the fields to return in the query. Object of fields to include or exclude (not both), {'a':1}
 *  - **skip** {Number, default:0}, set to skip N documents ahead in your query (useful for pagination).
 *  - **hint** {Object}, tell the query to use specific indexes in the query. Object of indexes to use, {'_id':1}
 *  - **explain** {Boolean, default:false}, explain the query instead of returning the data.
 *  - **snapshot** {Boolean, default:false}, snapshot query.
 *  - **timeout** {Boolean, default:false}, specify if the cursor can timeout.
 *  - **tailable** {Boolean, default:false}, specify if the cursor is tailable.
 *  - **batchSize** {Number, default:0}, set the batchSize for the getMoreCommand when iterating over the query results.
 *  - **returnKey** {Boolean, default:false}, only return the index key.
 *  - **maxScan** {Number}, Limit the number of items to scan.
 *  - **min** {Number}, Set index bounds.
 *  - **max** {Number}, Set index bounds.
 *  - **showDiskLoc** {Boolean, default:false}, Show disk location of results.
 *  - **comment** {String}, You can put a $comment field on a query to make looking in the profiler logs simpler.
 *  - **raw** {Boolean, default:false}, Return all BSON documents as Raw Buffer documents.
 *  - **readPreference** {String}, the preferred read preference, require('mongodb').ReadPreference (ReadPreference.PRIMARY, ReadPreference.PRIMARY_PREFERRED, ReadPreference.SECONDARY, ReadPreference.SECONDARY_PREFERRED, ReadPreference.NEAREST).
 *  - **partial** {Boolean, default:false}, specify if the cursor should return partial results when querying against a sharded system
 *
 * @param {Object|ObjectID} query query object to locate the object to modify
 * @param {Object} [options] additional options during update.
 * @param {Function} callback this will be called after executing this method. The first parameter will contain the Error object if an error occured, or null otherwise. While the second parameter will contain the results from the findOne method or null if an error occured.
 * @return {Cursor} returns a cursor to the query
 * @api public
 */
Collection.prototype.findOne = function() { return query.findOne; }();

/**
 * Expose.
 */
exports.Collection = Collection;
