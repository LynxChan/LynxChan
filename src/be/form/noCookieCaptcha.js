'use strict';

var captchaOps = require('../engine/captchaOps');
var formOps = require('../engine/formOps');
var url = require('url');
var miscOps = require('../engine/miscOps');
var domManipulator = require('../engine/domManipulator');

exports.process = function(req, res) {

  var parameters = url.parse(req.url, true).query;

  captchaOps.generateCaptcha(function generatedCaptcha(error, captchaId) {
    if (error) {
      formOps.outputError(error, 500, res);
    } else {
      res.writeHead(200, miscOps.corsHeader('text/html'));

      res.end(domManipulator.noCookieCaptcha(parameters, captchaId));
    }

  });

};