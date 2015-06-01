'use strict';

// handles any action regarding user uploads
var fs = require('fs');
var imagemagick = require('imagemagick');
var gsHandler = require('./gridFsHandler');
var db = require('../db');
var threads = db.threads();
var posts = db.posts();

exports.removeFromDisk = function(path, callback) {
  fs.unlink(path, function removedFile(error) {
    if (callback) {
      callback(error);
    }
  });
};

function updatePostingFiles(boardUri, threadId, postId, files, file, callback,
    index) {

  var queryBlock = {
    boardUri : boardUri,
    threadId : threadId
  };

  var collectionToQuery = threads;

  if (postId) {
    queryBlock.postId = postId;
    collectionToQuery = posts;
  }

  collectionToQuery.update(queryBlock, {
    $push : {
      files : {
        originalName : file.title,
        path : file.path,
        thumb : file.thumbPath,
        name : file.gfsName
      }
    }
  }, function updatedPosting(error) {
    if (error) {
      callback(error);
    } else {
      exports.saveUploads(boardUri, threadId, postId, files, callback,
          index + 1);
    }

  });

}

function cleanThumbNail(boardUri, threadId, postId, files, file, callback,
    index, saveError) {

  if (file.mime.indexOf('image/') !== -1) {

    exports.removeFromDisk(file.pathInDisk + '_t', function removed(
        deletionError) {
      if (saveError || deletionError) {
        callback(saveError || deletionError);
      } else {
        updatePostingFiles(boardUri, threadId, postId, files, file, callback,
            index);
      }

    });
  } else {

    if (saveError) {
      callback(saveError);
    } else {
      updatePostingFiles(boardUri, threadId, postId, files, file, callback,
          index);
    }
  }
}

function transferFilesToGS(boardUri, threadId, postId, files, file, callback,
    index) {

  gsHandler.saveUpload(boardUri, threadId, postId, file,
      function transferedFile(error) {

        cleanThumbNail(boardUri, threadId, postId, files, file, callback,
            index, error);
      });
}

exports.saveUploads = function(boardUri, threadId, postId, files, callback,
    index) {

  index = index || 0;

  if (index < files.length) {

    var file = files[index];

    if (file.mime.indexOf('image/') !== -1) {

      imagemagick.resize({
        srcPath : file.pathInDisk,
        dstPath : file.pathInDisk + '_t',
        width : 256,
        height : 256,
      }, function(error, stdout, stderr) {
        if (error) {
          callback(error);
        } else {

          transferFilesToGS(boardUri, threadId, postId, files, file, callback,
              index);

        }
      });
    } else {
      transferFilesToGS(boardUri, threadId, postId, files, file, callback,
          index);
    }

  } else {
    callback();
  }
};