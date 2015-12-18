'use strict';

// handles request for static files

var kernel = require('../kernel');
var settingsHandler = require('../settingsHandler');
var settings = settingsHandler.getGeneralSettings();
var verbose = settings.verbose;
var disable304 = settings.disable304;
var debug = kernel.debug();
var fs = require('fs');
var url = require('url');
var gridFs;
var miscOps;

var filesCache = {};

exports.loadDependencies = function() {

  gridFs = require('./gridFsHandler');
  miscOps = require('./miscOps');

};

exports.respond = function(fileContent, header, res) {

  res.writeHead(200, header);

  res.end(fileContent, 'binary');

};

exports.readAndRespond = function(pathName, modifiedTime, header, res, cb) {

  header.push([ 'last-modified', modifiedTime.toString() ]);
  header.push([ 'expires', new Date().toString() ]);

  fs.readFile(settings.fePath + '/static' + pathName, function(error, data) {

    if (error) {
      cb(error);
      return;
    }

    var file = {
      mtime : modifiedTime,
      content : data
    };

    if (!debug) {
      filesCache[pathName] = file;
    }

    exports.respond(data, header, res);

  });
};

// reads file stats to find out if theres a new version
exports.readFileStats = function(pathName, lastSeen, header, req, res, cb) {

  fs.stat(settings.fePath + '/static' + pathName, function gotStats(error,
      stats) {
    if (error) {
      if (debug) {
        console.log(error);
      }

      gridFs.outputFile('/404.html', req, res, cb);

    } else if (lastSeen === stats.mtime.toString() && !disable304) {
      if (verbose) {
        console.log('304');
      }

      res.writeHead(304);
      res.end();
    } else {
      exports.readAndRespond(pathName, stats.mtime, header, res, cb);
    }
  });

};

exports.outputFile = function(req, res, callback) {

  var lastSeen = req.headers ? req.headers['if-modified-since'] : null;

  var pathName = url.parse(req.url).pathname;

  if (verbose) {
    console.log('Outputting static file \'' + pathName + '\'');
  }

  var header = miscOps.corsHeader(miscOps.getMime(pathName));

  var file;

  if (!debug) {
    file = filesCache[pathName];
  }

  if (!file) {
    exports.readFileStats(pathName, lastSeen, header, req, res, callback);
  } else if (lastSeen === file.mtime.toString() && !disable304) {

    if (verbose) {
      console.log('304');

    }

    res.writeHead(304);
    res.end();

  } else {
    exports.respond(file.content, header, res);
  }

};