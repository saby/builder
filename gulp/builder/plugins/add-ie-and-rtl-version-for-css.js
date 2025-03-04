/**
 * Plugin for addition of ie version of css source file
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const PosixVinyl = require('../../../lib/platform/vinyl');
const { buildRTLCss } = require('../../../lib/less/helpers');
const logger = require('../../../lib/logger').logger();
const getMetricsReporter = require('../../common/classes/metrics-reporter');

function createRtlContents(taskParameters, moduleInfo, file, contents) {
   let rtlContent = contents.toString();

   try {
      rtlContent = buildRTLCss(rtlContent);
   } catch (error) {
      let erroredCssCode = '';
      if (error.line) {
         const cssParts = rtlContent.split('\n');
         for (let i = error.line - 4; i <= error.line + 4; i++) {
            erroredCssCode += `${i}: ${cssParts[i]}\n`;
         }
      }

      const rtlError = new Error(`Error during rtl css generator: ${error.message} Css code:\n${erroredCssCode}`);
      logger.warning({
         error: rtlError,
         filePath: file.pRelativeSource(moduleInfo.path),
         moduleInfo
      });
      taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
      getMetricsReporter().markFailedModule(moduleInfo);
   }

   return rtlContent;
}

/**
 * Plugin declaration
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         const isMinifiedCss = file.pHistory[0].endsWith('.min.css');

         // dont use symlinks for minified files in sources. It could cause EEXIST
         // error when there is an attempt to symlink it while compiled minified version
         // is already written in an output directory
         if (isMinifiedCss) {
            file.strictCopy = true;
         }
         if (file.pExtname === '.css' && file.pHistory[0].endsWith('.css') && !isMinifiedCss) {
            // third-party namespace could have rtl versions of css, ignore this stage for them
            if (taskParameters.config.buildRtl && !file.pPath.endsWith('.rtl.css')) {
               const contents = createRtlContents(taskParameters, moduleInfo, file, file.contents);
               const rtlFile = new PosixVinyl({
                  pBase: moduleInfo.path,
                  pPath: file.pPath.replace('.css', '.rtl.css'),
                  contents: Buffer.from(contents),
                  stat: {
                     mtime: new Date().toString()
                  },
                  strictCopy: true
               });

               if (file.productionContents) {
                  const prodContents = createRtlContents(taskParameters, moduleInfo, file, file.productionContents);

                  rtlFile.productionContents = Buffer.from(prodContents);
               }

               this.push(rtlFile);
            }
         }

         taskParameters.metrics.storePluginTime('generate rtl for css', startTime);
         callback(null, file);
      }
   );
};
