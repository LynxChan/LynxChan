'use strict';

// Decides what to do with an incoming request and will output errors if they
// are not handled

var logger = require('../logger');
var kernel = require('../kernel');
var indexString = 'index.html';
var url = require('url');
var proxy = require('http-proxy').createProxyServer({
  secure : false
});
var multiBoardAllowed;
var verbose;
var verboseApis;
var maintenance;
var feDebug = kernel.feDebug();
var debug = kernel.debug();
var db = require('../db');
var langs = db.languages();
var boards = db.boards();
var useLanguages;
var formOps;
var apiOps;
var miscOps;
var gridFs;
var cacheHandler;
var lastSlaveIndex = 0;
var slaves;
var master;
var port;
proxy.on('proxyReq', function(proxyReq, req, res, options) {
  proxyReq.setHeader('x-forwarded-for', logger.getRawIp(req));
});

exports.formImages = [ '/captcha.js', '/randomBanner.js' ];

exports.loadSettings = function() {

  var settings = require('../settingsHandler').getGeneralSettings();

  multiBoardAllowed = settings.multiboardThreadCount;
  verbose = settings.verbose || settings.verboseMisc;
  verboseApis = settings.verbose || settings.verboseApis;
  slaves = settings.slaves;
  useLanguages = settings.useAlternativeLanguages;
  master = settings.master;
  maintenance = settings.maintenance && !master;
  port = settings.port;
};

exports.loadDependencies = function() {

  formOps = require('./formOps');
  apiOps = require('./apiOps');
  miscOps = require('./miscOps');
  gridFs = require('./gridFsHandler');
  cacheHandler = require('./cacheHandler');

};

exports.readRangeHeader = function(range, totalLength) {

  if (!range) {
    return null;
  }

  var array = range.split(/bytes=([0-9]*)-([0-9]*)/);
  var start = parseInt(array[1]);
  var end = parseInt(array[2]);

  if (isNaN(start)) {
    start = totalLength - end;
    end = totalLength - 1;
  } else if (isNaN(end)) {
    end = totalLength - 1;
  }

  // limit last-byte-pos to current length
  if (end > totalLength - 1) {
    end = totalLength - 1;
  }

  // invalid or unsatisifiable
  if (isNaN(start) || isNaN(end) || start > end || start < 0) {
    return null;
  }

  return {
    start : start,
    end : end
  };

};

exports.outputError = function(error, res) {

  var header = miscOps.getHeader('text/plain');

  if (verbose) {
    console.log(error);
  }

  switch (error.code) {
  case 'ENOENT':
  case 'MODULE_NOT_FOUND':
    res.writeHead(404, header);
    res.write('404');

    break;

  default:
    res.writeHead(500, header);

    res.write('500\n' + error.toString());

    if (!verbose && error.code !== 'EISDIR') {
      console.log(error);
    }

    break;
  }

  res.end();

};

exports.processApiRequest = function(req, pathName, res) {

  if (verboseApis) {
    console.log('Processing api request: ' + pathName);
  }

  try {
    if (maintenance && !req.fromSlave) {
      apiOps.outputResponse(null, null, 'maintenance', res);
    } else {

      var modulePath;

      if (pathName.indexOf('/addon.js', 0) !== -1) {
        modulePath = '../api/addon.js';
      } else {
        modulePath = '../api' + pathName;
      }

      require(modulePath).process(req, res);

    }

  } catch (error) {
    apiOps.outputError(error, res);
  }

};

exports.showMaintenance = function(req, pathName, res) {

  res.writeHead(302, {
    'Location' : exports.formImages.indexOf(pathName) >= 0 ? kernel
        .maintenanceImage() : '/maintenance.html'
  });

  res.end();

};

exports.processFormRequest = function(req, pathName, res) {

  if (verboseApis) {
    console.log('Processing form request: ' + pathName);
  }

  try {
    if (maintenance && !req.fromSlave) {
      exports.showMaintenance(req, pathName, res);
    } else {
      var modulePath;

      if (pathName.indexOf('/addon.js', 0) !== -1) {
        modulePath = '../form/addon.js';
      } else {
        modulePath = '../form' + pathName;
      }

      if (feDebug) {

        var templateHandler = require('./templateHandler');

        templateHandler.dropAlternativeTemplates();
        templateHandler.loadTemplates();
      }

      require(modulePath).process(req, res);
    }

  } catch (error) {
    formOps.outputError(error, 500, res, req.language);
  }

};

exports.extractMultiBoard = function(parts) {

  if (parts.length < 2) {
    return false;
  }

  var boards = parts[1].split('+');

  if (boards.length < 2) {
    return false;
  }

  var boardsToPick = [];

  for (var i = 0; i < boards.length; i++) {

    var piece = boards[i];

    if (!piece || /\W/.test(piece)) {
      return false;
    }

    boardsToPick.push(piece);

  }

  return boardsToPick;

};

exports.redirect = function(req, res) {

  var proxyUrl = req.connection.encrypted ? 'https' : 'http';

  proxyUrl += '://';

  proxyUrl += slaves[lastSlaveIndex++];

  if (lastSlaveIndex >= slaves.length) {
    lastSlaveIndex = 0;
  }

  if (!req.connection.encrypted) {
    proxyUrl += ':' + port;
  }

  if (verbose) {
    console.log('Proxying to ' + proxyUrl);
  }

  proxy.web(req, res, {
    target : proxyUrl
  }, function proxyed(error) {

    try {
      exports.outputError(error, res);
    } catch (error) {
      console.log(error);
    }

  });

  return true;

};

exports.checkForService = function(req, pathName, isSlave) {

  if (!slaves.length || isSlave) {
    return true;
  }

  var toGlobalSettings = pathName.indexOf('/globalSettings') === 0;
  var setGlobalSettingsApi = pathName.indexOf('/.api/saveGlobalSettings') === 0;
  var setGlobalSettingsForm = pathName.indexOf('/saveGlobalSettings') === 0;

  var toRet = setGlobalSettingsForm || maintenance || toGlobalSettings;

  return toRet || setGlobalSettingsApi;

};

exports.checkForRedirection = function(req, pathName, res) {

  var remote = req.connection.remoteAddress;

  var isSlave = slaves.indexOf(remote) > -1;

  // Is up to the webserver to drop unwanted connections.
  var isLocal = remote === '127.0.0.1';
  var isMaster = master === remote;

  if (master) {

    if (!isMaster && !isLocal) {
      req.connection.destroy();
      return true;
    } else {
      req.trustedProxy = true;
      return false;
    }

  } else if (exports.checkForService(req, pathName, isSlave)) {

    req.trustedProxy = isLocal;
    req.fromSlave = isSlave;

    return false;

  } else {
    return exports.redirect(req, res);
  }

};

exports.pickFromPossibleLanguages = function(languages, returnedLanguages) {

  for (var i = 0; i < languages.length; i++) {

    for (var j = 0; j < returnedLanguages.length; j++) {

      var returnedLanguage = returnedLanguages[j];

      if (returnedLanguage.headerValues.indexOf(languages[i].language) >= 0) {
        return returnedLanguage;
      }

    }

  }

};

exports.getLanguageToUse = function(req, callback) {

  var languages = req.headers['accept-language'].substring(0, 64).split(',')
      .map(function(element) {
        element = element.trim();

        if (element.indexOf(';q=') < 0) {
          return {
            language : element,
            priority : 1
          };
        } else {

          var matches = element.match(/([a-zA-Z-]+);q\=([0-9\.]+)/);

          if (!matches) {
            return {
              priority : 0
            };
          }

          return {
            language : matches[1],
            priority : +matches[2]
          };

        }

      });

  languages.sort(function(a, b) {
    return b.priority - a.priority;
  });

  var acceptableLanguages = [];

  for (var i = 0; i < languages.length; i++) {

    var language = languages[i];

    if (language.priority) {
      acceptableLanguages.push(language.language);
    }
  }

  langs.find({
    headerValues : {
      $in : acceptableLanguages
    }
  }).toArray(
      function gotLanguages(error, returnedLanguages) {

        if (error) {
          callback(error);
        } else if (!returnedLanguages.length) {
          callback();
        } else {
          callback(null, exports.pickFromPossibleLanguages(languages,
              returnedLanguages));
        }

      });

};

exports.routeToFormApi = function(req, pathName, res, firstPart) {

  if (firstPart.length < 4) {
    return false;
  }

  if (firstPart.lastIndexOf('.js') === firstPart.length - 3) {
    exports.processFormRequest(req, pathName, res);
    return true;
  }

};

exports.getCleanPathName = function(pathName) {

  if (!pathName || pathName.length <= indexString.length) {
    return pathName;
  }

  var delta = pathName.length - indexString.length;

  if (pathName.lastIndexOf(indexString) === delta) {
    pathName = pathName.substring(0, pathName.length - indexString.length);
  }

  return pathName;

};

exports.multiBoardsDiff = function(found, toUse) {

  if (found.length !== toUse.length) {
    return true;
  }

  for (var i = 0; i < found.length; i++) {

    if (found[i] !== toUse[i]) {
      return true;
    }

  }

  return false;

};

exports.checkMultiBoardRouting = function(splitArray, req, res, callback) {

  if (!multiBoardAllowed || splitArray.length > 3) {
    callback();
    return;
  }

  if (splitArray.length > 2 && splitArray[2] && splitArray[2] !== '1.json') {
    callback();
    return;
  }

  var boardsToUse = exports.extractMultiBoard(splitArray);

  if (!boardsToUse) {
    callback();
    return;
  }

  boards.aggregate([ {
    $match : {
      boardUri : {
        $in : boardsToUse
      }
    }
  }, {
    $project : {
      boardUri : 1,
      _id : 0
    }
  }, {
    $group : {
      _id : 0,
      boards : {
        $push : '$boardUri'
      }
    }
  } ]).toArray(function gotExistingBoards(error, results) {

    if (error || !results.length) {
      callback(error);
    } else {

      var foundBoards = results[0].boards.sort();

      var diff = exports.multiBoardsDiff(foundBoards, boardsToUse);

      if (diff || splitArray.length === 2) {

        splitArray[1] = foundBoards.join('+');

        if (splitArray.length === 2) {
          splitArray.push('');
        }

        res.writeHead(302, {
          'Location' : splitArray.join('/')
        });
        res.end();

      } else {
        req.boards = foundBoards;
        callback();
      }

    }

  });

};

exports.decideRouting = function(req, pathName, res, callback) {

  if (pathName.indexOf('/.api/') === 0) {
    exports.processApiRequest(req, pathName.substring(5), res);
    return;
  } else if (pathName.indexOf('/.static/') === 0) {
    cacheHandler.outputFile(pathName, req, res, callback, true);
    return;
  }

  pathName = exports.getCleanPathName(pathName);

  var splitArray = pathName.split('/');

  if (exports.routeToFormApi(req, pathName, res, splitArray[1])) {
    return;
  }

  exports.checkMultiBoardRouting(splitArray, req, res, function checked(error) {

    var gotSecondString = splitArray.length === 2 && splitArray[1];

    if (gotSecondString && !/\W/.test(splitArray[1])) {

      // redirects if we missed the slash on the board front-page
      res.writeHead(302, {
        'Location' : '/' + splitArray[1] + '/'
      });
      res.end();

    } else {
      cacheHandler.outputFile(pathName, req, res, callback);
    }
  });

};

exports.serve = function(req, pathName, res, callback) {

  if (req.headers['accept-encoding']) {
    req.compressed = req.headers['accept-encoding'].indexOf('gzip') > -1;
  } else {
    req.compressed = false;
  }

  if (req.headers['accept-language'] && useLanguages) {

    exports.getLanguageToUse(req, function gotLanguage(error, language) {

      if (error) {

        if (debug) {
          throw error;
        } else if (verbose) {
          console.log(error);
        }

      }

      req.language = language;

      exports.decideRouting(req, pathName, res, callback);

    });

  } else {
    exports.decideRouting(req, pathName, res, callback);
  }

};

exports.handle = function(req, res) {

  if (!req.headers || !req.headers.host) {
    res.writeHead(200, miscOps.getHeader('text/plain'));
    res.end('get fucked, m8 :^)');
    return;
  }

  var pathName = url.parse(req.url).pathname;

  if (exports.checkForRedirection(req, pathName, res)) {
    return;
  }

  exports.serve(req, pathName, res, function served(error) {

    if (error) {
      exports.outputError(error, res);
    }

  });

};