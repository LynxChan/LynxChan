'use strict';

var formOps = require('../engine/formOps');
var boardOps = require('../engine/boardOps').meta;
var lang = require('../engine/langOps').languagePack();
var mandatoryParameters = [ 'boardUri' ];
var possibleSettings = boardOps.getValidSpecialSettings();

function setBoardSpecialSettings(userData, parameters, res, auth) {

  if (formOps.checkBlankParameters(parameters, mandatoryParameters, res)) {
    return;
  }

  var desiredSettings = [];

  for (var i = 0; i < possibleSettings.length; i++) {

    var setting = possibleSettings[i];

    if (parameters[setting]) {
      desiredSettings.push(setting);
    }

  }

  parameters.specialSettings = desiredSettings;

  boardOps.setSpecialSettings(userData, parameters,
      function specialSettingsSaved(error) {
        if (error) {
          formOps.outputError(error, 500, res);
        } else {
          var redirect = '/boardModeration.js?boardUri=' + parameters.boardUri;

          formOps.outputResponse(lang.msgBoardSpecialSettingsSaved, redirect,
              res, null, auth);
        }

      });

}

exports.process = function(req, res) {

  formOps.getAuthenticatedPost(req, res, true, function gotData(auth, userData,
      parameters) {

    setBoardSpecialSettings(userData, parameters, res, auth);

  });

};