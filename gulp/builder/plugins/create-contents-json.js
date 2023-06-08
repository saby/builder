/**
 * Gulp plugin for creating of contents.json and contents.js meta files
 * (information for require.js, localization description, etc.)
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers');
const { generateWithStaticDependencies } = require('../../../lib/espree/convert-to-umd');

function generateContentsContent(uiModuleName, sortedContents, generateUMD) {
   const factoryFunctionDecl = `function(){return ${sortedContents};}`;
   const moduleName = `${uiModuleName}/contents.json`;

   if (generateUMD) {
      return generateWithStaticDependencies({
         factoryFunctionCall: `define('${moduleName}', [], factory)`,
         factoryFunctionDecl
      });
   }

   return `define('${moduleName}',[],${factoryFunctionDecl});`;
}

/**
 * Plugin declaration
 * @param {BuildConfiguration} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         callback(null, file);
         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         const moduleName = path.basename(moduleInfo.output);
         try {
            // подготовим contents.json и contents.js
            if (taskParameters.config.version) {
               moduleInfo.contents.buildnumber = `%{MODULE_VERSION_STUB=${moduleName}}`;
            }

            if (taskParameters.config.useReact) {
               moduleInfo.contents.useReact = true;
            }

            // ECSMAScript version for JIT compilation of wml/tmpl files in RJs plugins.
            moduleInfo.contents.modules[moduleInfo.runtimeModuleName].ESVersion = (
               moduleInfo.ESVersion || taskParameters.config.ESVersion
            );

            // save modular contents.js into joined if needed.
            if (taskParameters.config.joinedMeta) {
               helpers.joinContents(taskParameters.config.commonContents, moduleInfo.contents);
            }
            const sortedContents = JSON.stringify(helpers.sortObject(moduleInfo.contents));
            const contentsBuffer = Buffer.from(sortedContents);
            const contentsJsContent = generateContentsContent(
               moduleName,
               sortedContents,
               taskParameters.config.generateUMD
            );
            const contentsJsonFile = new PosixVinyl({
               pPath: 'contents.json',
               contents: contentsBuffer,
               moduleInfo,
               compiled: true
            });
            const contentsJsonJsFile = new PosixVinyl({
               pPath: 'contents.json.js',
               contents: Buffer.from(contentsJsContent),
               moduleInfo,
               compiled: true
            });
            this.push(contentsJsonJsFile);
            this.push(contentsJsonFile);
            if (taskParameters.config.isReleaseMode) {
               const contentsMinJsonFile = new PosixVinyl({
                  pPath: 'contents.min.json',
                  contents: contentsBuffer,
                  moduleInfo,
                  compiled: true
               });
               this.push(contentsMinJsonFile);
               const contentsJsonMinJsFile = new PosixVinyl({
                  pPath: 'contents.json.min.js',
                  contents: Buffer.from(contentsJsContent),
                  moduleInfo,
                  compiled: true
               });
               this.push(contentsJsonMinJsFile);
            }
         } catch (error) {
            logger.error({
               message: 'Builder error',
               error,
               moduleInfo
            });
         }

         taskParameters.metrics.storePluginTime('presentation service meta', startTime);
         callback();
      }
   );
};
