var ServerCapabilities = function() {  
  // Capabilities
  var certified = true;
  var dataDictionary = true;

  // Map up read only parameters
  setup_get_property(this, "isCertified", certified);
  setup_get_property(this, "hasDataDictionary", dataDictionary);
}

var setup_get_property = function(object, name, value) {
  Object.defineProperty(object, name, {
      enumerable: true
    , get: function () { return value; }
  });  
}

exports.ServerCapabilities = ServerCapabilities;
