/**
  Base object used for common functionality
**/
var BaseCommand = exports.BaseCommand = function BaseCommand() {
};

var id = 1;
BaseCommand.prototype.getRequestId = function getRequestId() {
  if (!this.requestId) this.requestId = id++;
  return this.requestId;
};

BaseCommand.prototype.updateRequestId = function() {
  this.requestId = id++;
  return this.requestId;
};

// OpCodes
BaseCommand.OP_REPLY = 1;
BaseCommand.OP_MSG = 1000;
BaseCommand.OP_QUERY = 2004;
