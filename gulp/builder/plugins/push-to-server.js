/**
 * Plugin that adds all of changed files into the "push to server" list
 * for HotReload
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger(),
   through = require('through2');

const GRANTED_EXTENSIONS = [
   '.js',
   '.css',
   '.json',
   '.wml',
   '.tmpl',
   '.xhtml'
];

const NON_CACHED_META = [
   'libraries.json',
   'contents.json',
   'contents.min.json',
   'contents.json.js',
   'contents.json.min.js',
   'ru.js',
   'en.js',

   // dont push minified versions of files
   '.min.js'
];

/**
 * Plugin declaration
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      try {
         if (GRANTED_EXTENSIONS.includes(file.pExtname) && !NON_CACHED_META.includes(path.basename(file.pRelative))) {
            const outputFilePath = path.join(
               path.basename(moduleInfo.output),
               file.pRelative
            );
            taskParameters.addChangedFile(outputFilePath);
         }
         callback(null, file);
         return;
      } catch (error) {
         logger.error({ error });
      }
      callback();
   });
};
