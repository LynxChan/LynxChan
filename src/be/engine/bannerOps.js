'use strict';

var mongo = require('mongodb');
var ObjectID = mongo.ObjectID;
var settings = require('../settingsHandler').getGeneralSettings();
var maxBannerSize = settings.maxBannerSizeB;
var db = require('../db');
var boards = db.boards();
var files = db.files();
var gridFsHandler;
var lang;

var globalBoardModeration = settings.allowGlobalBoardModeration;

exports.loadDependencies = function() {

  gridFsHandler = require('./gridFsHandler');
  lang = require('./langOps').languagePack();

};

// Section 1: Banner deletion {
exports.removeBanner = function(banner, callback) {

  gridFsHandler.removeFiles(banner.filename, function removedFile(error) {
    callback(error, banner.metadata.boardUri);
  });

};

exports.deleteBanner = function(userData, parameters, callback) {

  var admin = userData.globalRole <= 1;

  try {

    files.findOne({
      _id : new ObjectID(parameters.bannerId)
    }, function gotBanner(error, banner) {
      if (error) {
        callback(error);
      } else if (!banner) {
        callback(lang.errBannerNotFound);
      } else {

        if (!banner.metadata.boardUri && !admin) {
          callback(lang.errDeniedGlobalBannerManagement);
        } else if (!banner.metadata.boardUri) {
          exports.removeBanner(banner, callback);
        } else {
          var globallyAllowed = admin && globalBoardModeration;

          // style exception, too simple
          boards.findOne({
            boardUri : banner.metadata.boardUri
          }, function gotBoard(error, board) {
            if (error) {
              callback(error);
            } else if (!board) {
              callback(lang.errBoardNotFound);
            } else if (board.owner !== userData.login && !globallyAllowed) {
              callback(lang.errDeniedChangeBoardSettings);
            } else {
              exports.removeBanner(banner, callback);
            }
          });
          // style exception, too simple

        }

      }

    });
  } catch (error) {
    callback(error);
  }
};
// } Section 1: Banner deletion

// Section 2: Banner creation {
exports.writeNewBanner = function(parameters, callback) {

  var bannerPath = '/' + (parameters.boardUri || '.global') + '/banners/';
  bannerPath += new Date().getTime();

  var file = parameters.files[0];

  gridFsHandler.writeFile(file.pathInDisk, bannerPath, file.mime, {
    boardUri : parameters.boardUri,
    type : 'banner'
  }, callback);

};

exports.addBanner = function(userData, parameters, callback) {

  if (!parameters.files.length) {
    callback(lang.errNoFiles);
    return;
  } else if (parameters.files[0].mime.indexOf('image/') === -1) {
    callback(lang.errNotAnImage);
    return;
  } else if (parameters.files[0].size > maxBannerSize) {
    callback(lang.errBannerTooLarge);
  }

  var admin = userData.globalRole <= 1;

  var globallyAllowed = admin && globalBoardModeration;

  if (!parameters.boardUri && !admin) {

    callback(lang.errDeniedGlobalBannerManagement);

  } else if (!parameters.boardUri) {
    exports.writeNewBanner(parameters, callback);
  } else {

    boards.findOne({
      boardUri : parameters.boardUri
    }, function gotBoard(error, board) {
      if (error) {
        callback(error);
      } else if (!board) {
        callback(lang.errBoardNotFound);
      } else if (board.owner !== userData.login && !globallyAllowed) {
        callback(lang.errDeniedChangeBoardSettings);
      } else {
        exports.writeNewBanner(parameters, callback);

      }
    });

  }

};
// }Section 2: Banner creation

// Section 3: Banner management {
exports.readBannerData = function(boardUri, callback) {

  files.find({
    'metadata.boardUri' : boardUri || {
      $exists : false
    },
    'metadata.type' : 'banner'
  }).sort({
    uploadDate : 1
  }).toArray(function(error, banners) {
    callback(error, banners);
  });

};

exports.getBannerData = function(userData, boardUri, callback) {

  var admin = userData.globalRole <= 1;

  if (!admin && !boardUri) {
    callback(lang.errDeniedGlobalBannerManagement);
  } else if (!boardUri) {
    exports.readBannerData(null, callback);
  } else {

    var globallyAllowed = admin && globalBoardModeration;

    boards.findOne({
      boardUri : boardUri
    }, function gotBoard(error, board) {
      if (error) {
        callback(error);
      } else if (!board) {
        callback(lang.errBoardNotFound);
      } else if (board.owner !== userData.login && !globallyAllowed) {
        callback(lang.errDeniedChangeBoardSettings);
      } else {
        exports.readBannerData(boardUri, callback);
      }
    });
  }

};
// } Section 3: Banner management