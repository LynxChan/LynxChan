'use strict';

// general operations for the json api
var settings = require('../settingsHandler').getGeneralSettings();
var debug = require('../boot').debug();
var verbose = settings.verbose;
var bans = require('../db').bans();
var fs = require('fs');
var crypto = require('crypto');
var path = require('path');
var tempDir = settings.tempDirectory;
var maxRequestSize = settings.maxRequestSizeB;
var maxFileSize = settings.maxFileSizeB;
var maxFiles = settings.maxFiles;
var accountOps;
var miscOps;
var modOps;
var uploadHandler;
var allowedMimes;
var videoMimes;
var lang;

var FILE_EXT_RE = /(\.[_\-a-zA-Z0-9]{0,16}).*/;
// replace base64 characters with safe-for-filename characters
var b64Safe = {
  '/' : '_',
  '+' : '-'
};

exports.loadDependencies = function() {

  accountOps = require('./accountOps');
  miscOps = require('./miscOps');
  modOps = require('./modOps');
  uploadHandler = require('./uploadHandler');
  allowedMimes = uploadHandler.supportedMimes();
  videoMimes = uploadHandler.videoMimes();
  lang = require('./langOps').languagePack();

};

exports.uploadPath = function(baseDir, filename) {
  var ext = path.extname(filename).replace(FILE_EXT_RE, '$1');
  var name = exports.randoString(18) + ext;
  return path.join(baseDir, name);
};

exports.randoString = function(size) {
  return exports.rando(size).toString('base64').replace(/[\/\+]/g, function(x) {
    return b64Safe[x];
  });
};

exports.rando = function(size) {
  try {
    return crypto.randomBytes(size);
  } catch (err) {
    return crypto.pseudoRandomBytes(size);
  }
};

exports.checkBlankParameters = function(object, parameters, res) {

  function failCheck(parameter, reason) {

    if (verbose) {
      console.log('Blank reason: ' + reason);
    }

    exports.outputResponse(null, parameter, 'blank', res);

    return true;
  }

  if (!object) {

    failCheck();

    return true;

  }

  for (var i = 0; i < parameters.length; i++) {
    var parameter = parameters[i];

    if (!object.hasOwnProperty(parameter)) {
      return failCheck(parameter, 'no parameter');

    }

    if (object[parameter] === null) {
      return failCheck(parameter, 'null');
    }

    if (object[parameter] === undefined) {
      return failCheck(parameter, 'undefined');
    }

    if (!object[parameter].toString().trim().length) {
      return failCheck(parameter, 'length');
    }
  }

  return false;

};

// Section 1: Request parsing {

// Section 1.1: Upload handling {
exports.getFileData = function(matches, res, stats, file, location, content,
    exceptionalMimes, finalArray, callback) {

  var mime = matches[1];

  if (stats.size > maxFileSize) {
    exports.outputResponse(null, null, 'fileTooLarge', res);
  } else if (allowedMimes.indexOf(mime) === -1 && !exceptionalMimes) {
    exports.outputResponse(null, null, 'formatNotAllowed', res);
  } else {

    var toPush = {
      title : file.name,
      md5 : crypto.createHash('md5').update(content, 'base64').digest('hex'),
      size : stats.size,
      mime : mime,
      pathInDisk : location
    };

    var video = videoMimes.indexOf(toPush.mime) > -1;

    var measureFunction;

    if (toPush.mime === 'image/gif') {
      measureFunction = uploadHandler.getGifBounds;
    } else if (toPush.mime.indexOf('image/') > -1) {
      measureFunction = uploadHandler.getImageBounds;
    } else if (video && settings.mediaThumb) {
      measureFunction = uploadHandler.getVideoBounds;
    }

    if (measureFunction) {

      measureFunction(toPush, function gotDimensions(error, width, height) {
        if (!error) {
          toPush.width = width;
          toPush.height = height;

          finalArray.push(toPush);
        }

        callback(error);

      });

    } else {
      finalArray.push(toPush);

      callback();
    }
  }

};

exports.processFile = function(file, res, finalArray, toRemove,
    exceptionalMimes, callback) {

  var matches = file.content.match(/^data:([0-9A-Za-z-+\/]+);base64,(.+)$/);

  if (!matches) {
    exports.outputResponse(null, null, 'fileParseError', res);
    return;
  }

  var location = exports.uploadPath(tempDir, file.name);

  var content = matches[2];

  fs.writeFile(location, new Buffer(content, 'base64'), function wroteFile(
      error) {

    if (!error) {
      toRemove.push(location);

      // style exception, too simple
      fs.stat(location, function gotStats(error, stats) {
        if (error) {
          callback(error);
        } else {
          exports.getFileData(matches, res, stats, file, location, content,
              exceptionalMimes, finalArray, callback);
        }

      });
      // style exception, too simple

    } else {
      callback(error);
    }

  });

};

exports.storeImages = function(parsedData, res, finalArray, toRemove, callback,
    exceptionalMimes) {

  var hasFilesField = parsedData.parameters && parsedData.parameters.files;

  var tooManyFiles = finalArray.length === maxFiles;

  if (!tooManyFiles && hasFilesField && parsedData.parameters.files.length) {
    exports.processFile(parsedData.parameters.files.shift(), res, finalArray,
        toRemove, exceptionalMimes, function processedFile(error) {

          if (error) {

            if (error) {
              console.log(error);
            }

            if (debug) {
              throw error;
            }
          }

          exports.storeImages(parsedData, res, finalArray, toRemove, callback,
              exceptionalMimes);

        });

  } else {
    var parameters = parsedData.parameters || {};
    parameters.files = finalArray;

    var endingCb = function() {

      for (var j = 0; j < toRemove.length; j++) {
        uploadHandler.removeFromDisk(toRemove[j]);
      }

    };

    res.on('close', endingCb);

    res.on('finish', endingCb);

    if (verbose) {
      console.log('Api input: ' + JSON.stringify(parameters, null, 2));
    }

    callback(parsedData.auth, parameters, parsedData.captchaId);
  }

};
// } Section 1.1: Upload handling

exports.getAuthenticatedData = function(req, res, callback, optionalAuth,
    exceptionalMimes) {

  exports.getAnonJsonData(req, res, function gotData(auth, parameters,
      captchaId) {

    accountOps.validate(auth, function validatedRequest(error, newAuth,
        userData) {

      if (error && !optionalAuth) {
        exports.outputError(error, res);
      } else {
        callback(newAuth, userData, parameters, captchaId);
      }

    });

  }, exceptionalMimes);

};

exports.getAnonJsonData = function(req, res, callback, exceptionalMimes) {

  var body = '';

  var totalLength = 0;

  req.on('data', function dataReceived(data) {
    body += data;

    totalLength += data.length;

    if (totalLength > maxRequestSize) {
      req.connection.destroy();
    }
  });

  req.on('end', function dataEnded() {

    try {
      var parsedData = JSON.parse(body);

      exports.storeImages(parsedData, res, [], [], callback, exceptionalMimes);

    } catch (error) {
      exports.outputResponse(null, error.toString(), 'parseError', res);
    }

  });

};
// } Section 1: Request parsing

exports.outputError = function(error, res) {

  if (verbose) {
    console.log(error);
  }

  if (debug) {
    throw error;
  }

  exports.outputResponse(null, error.toString(), 'error', res);

};

exports.outputResponse = function(auth, data, status, res) {
  if (!res) {
    console.log('Null res object ' + status);
    return;
  }

  var output = {
    auth : auth || null,
    status : status,
    data : data || null
  };

  res.writeHead(200, miscOps.corsHeader('application/json'));

  if (verbose) {
    console.log('Api output: ' + JSON.stringify(output, null, 2));
  }

  res.end(JSON.stringify(output));
};

exports.checkForHashBan = function(parameters, req, res, callback) {

  modOps.hashBan.checkForHashBans(parameters, req, function gotBans(error,
      hashBans) {
    if (error) {
      callback(error);
    } else if (!hashBans) {
      callback();
    } else {
      exports.outputResponse(null, hashBans, 'hashBan', res);
    }
  });

};

exports.checkForBan = function(req, boardUri, res, callback) {

  modOps.ipBan.checkForBan(req, boardUri, function gotBan(error, ban) {
    if (error) {
      callback(error);
    } else if (ban) {
      if (ban.range) {
        ban.range = ban.range.join('.');
      }

      exports.outputResponse(null, {
        reason : ban.reason,
        range : ban.range,
        banId : ban._id,
        expiration : ban.expiration,
        board : ban.boardUri ? '/' + ban.boardUri + '/' : lang.miscAllBoards
            .toLowerCase()
      }, 'banned', res);
    } else {
      callback();
    }
  });

};