'use strict';

var apiOps = require('../engine/apiOps');
var modOps = require('../engine/modOps');

function placeRangeBan(userData, parameters, res) {

  modOps.placeRangeBan(userData, parameters, function rangeBanPlaced(error) {
    if (error) {
      apiOps.outputError(error, res);
    } else {
      apiOps.outputResponse(null, null, 'ok', res);
    }
  });

}

exports.process = function(req, res) {

  apiOps.getAuthenticatedData(req, res, function gotData(auth, userData,
      parameters) {

    placeRangeBan(userData, parameters, res);

  });

};