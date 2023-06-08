/**
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   transliterate = require('../../../lib/transliterate'),
   PosixVinyl = require('../../../lib/platform/vinyl'),
   helpers = require('../../../lib/helpers'),
   logger = require('../../../lib/logger').logger();
const { optimize, extendDefaultPlugins } = require('svgo');

// allowed icon name template
const ICON_NAME_REGEX = /^icon-[\w]+$/;

const postProcessSVG = (ast, params) => {
   if (ast.name === 'svg') {
      ast.name = 'symbol';
      if (ast.attributes) {
         ast.attributes.id = params.fileName;
      }
   }
   if (ast.attributes) {
      delete ast.attributes.xmlns;
   }
};

/**
 * remove selected attributes from root svg tag
 * @param {Object} ast ast tree of icon
 * @param {Object} params - transmitted parameters
 */
function removeRootSvgAttributes(ast, params) {
   if (ast.parentNode && ast.parentNode.type === 'root') {
      params.attributes.forEach((currentAttribute) => {
         delete ast.attributes[currentAttribute];
      });

      // if exist get viewBox to calculate icon size
      if (ast.attributes.viewBox) {
         params.extractedOptions.viewBox = ast.attributes.viewBox;
      }
   }
}

/**
 * returns svg options for optimizing
 * @param fileName
 * @returns {{plugins}}
 */
function getSvgoOptions(fileName) {
   return {
      plugins: extendDefaultPlugins([
         {
            name: 'cleanupIDs',
            active: false
         },
         {
            name: 'removeStyleElement',
            active: true
         },
         {
            name: 'processSvgIcon',
            type: 'perItem',
            params: {
               fileName
            },
            fn: postProcessSVG
         },
         {
            name: 'removeAttrs',
            active: true,
            params: {
               attrs: ['version', 'style', 'fill', 'xml.*']
            }
         },
         {
            name: 'mergePaths',
            active: false
         }
      ])
   };
}

/**
 * Remove dimensions attributes from svg tag(width and height) and calcs and
 * adds viewBox attr if it isn't existing
 * @param iconContent
 * @returns {JSAPI|{error: *}}
 */
function removeSelectedAttrsFromSvg(iconContent, attrsToRemove, extractedOptions) {
   return optimize(iconContent.toString(), {
      plugins: [{
         name: 'removeRootSvgAttrs',
         type: 'perItem',
         params: {
            attributes: attrsToRemove,
            extractedOptions
         },
         fn: removeRootSvgAttributes
      }]
   }).data;
}

/**
 * Replace svg tag with symbol tag and select 'id' attribute
 * as current svg name
 * @param {String} iconContent current svg content
 * @param {String} fileName current svg name
 * @returns {JSAPI|{error: *}}
 */
function replaceSvgTagWithSymbol(iconContent, fileName) {
   return optimize(iconContent.toString(), {
      plugins: [{
         name: 'processSvgIcon',
         type: 'perItem',
         params: {
            fileName
         },
         fn: postProcessSVG
      }]
   });
}

/**
 * returns icon size by its viewBox
 * @param {String} viewBox
 * @returns {string}
 */
function getIconSizeByViewBox(viewBox) {
   let iconPostfix = '';
   if (viewBox) {
      const [, , upperRightX, upperRightY] = viewBox.split(' ');
      if (upperRightX === upperRightY) {
         switch (upperRightX) {
            case '16':
               iconPostfix = 's';
               break;
            case '20':
               iconPostfix = 'sm';
               break;
            case '24':
               iconPostfix = 'l';
               break;
            default:
               break;
         }
      }
   }
   return iconPostfix;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
function processSvg(taskParameters, moduleInfo) {
   const packagesToBuild = [];

   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         try {
            if (!file.contents) {
               callback();
               return;
            }

            if (file.pExtname !== '.svg') {
               callback(null, file);
               return;
            }

            // throw an error if svg icon name isn't matching our allowed pattern
            if (!ICON_NAME_REGEX.test(file.pStem)) {
               logger.error({
                  message: `Svg name "${file.pStem}" is forbidden. Use a name matching the pattern ${ICON_NAME_REGEX.toString()}`,
                  filePath: file.pHistory[0],
                  moduleInfo
               });
               taskParameters.cache.markFileAsFailed(file.pRelativeSource);
               callback(null, file);
               taskParameters.metrics.storePluginTime('process svg', startTime);
               return;
            }

            let relativeFilePath = path.relative(moduleInfo.path, file.pHistory[0]);
            let outputPath = path.join(moduleInfo.output, transliterate(relativeFilePath));
            relativeFilePath = path.join(
               path.basename(moduleInfo.path),
               relativeFilePath
            );
            const nameParts = relativeFilePath.split(path.sep);
            const skipClean = file.contents.toString().includes('skip_clean="1"');
            const extractedOptions = {};

            if (skipClean) {
               file.contents = Buffer.from(
                  removeSelectedAttrsFromSvg(
                     file.contents.toString(),
                     ['skip_clean'],
                     extractedOptions
                  )
               );
            } else {
               file.contents = Buffer.from(
                  removeSelectedAttrsFromSvg(
                     file.contents.toString(),
                     ['width', 'height'],
                     extractedOptions
                  )
               );
            }

            // place icon sizes only if enabled
            let iconPostfix = '';
            if (taskParameters.config.iconSizes) {
               iconPostfix = getIconSizeByViewBox(extractedOptions.viewBox);

               if (iconPostfix && !nameParts[1].endsWith(`_${iconPostfix}`)) {
                  const oldPath = `${nameParts[0]}${path.sep}${nameParts[1]}`;
                  const newPath = `${nameParts[0]}${path.sep}${nameParts[1]}_${iconPostfix}`;

                  logger.warning({
                     message: `icon folder "${nameParts[1]}" should be renamed to "${nameParts[1]}_${iconPostfix}"`,
                     moduleInfo
                  });
                  file.pPath = file.pPath.replace(oldPath, newPath);
                  outputPath = outputPath.replace(oldPath, newPath);
               }
            }

            if (file.cached && !moduleInfo.dropCacheForIcons) {
               taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);

               if (iconPostfix) {
                  taskParameters.cache.addOutputFile(
                     path.dirname(file.pHistory[0]),
                     path.join(moduleInfo.output, `${nameParts[1]}_${iconPostfix}.svg`),
                     moduleInfo
                  );
               } else {
                  taskParameters.cache.addOutputFile(
                     path.dirname(file.pHistory[0]),
                     path.join(moduleInfo.output, `${nameParts[1]}.svg`),
                     moduleInfo
                  );
               }
               callback(null, file);
               taskParameters.metrics.storePluginTime('process svg', startTime);
               return;
            }
            if (nameParts.length >= 3) {
               packagesToBuild.push(`${nameParts[1]}${iconPostfix ? `_${iconPostfix}` : ''}`);
            }


            file.strictCopy = true;

            moduleInfo.cache.storeSvgContent(relativeFilePath, file.contents.toString(), skipClean, iconPostfix);

            taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);

            taskParameters.cache.addOutputFile(
               path.dirname(file.pHistory[0]),
               path.join(moduleInfo.output, `${nameParts[1]}.svg`),
               moduleInfo
            );
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource);
            logger.error({
               message: "Builder's error during processing svg image",
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }

         callback(null, file);
         taskParameters.metrics.storePluginTime('process svg', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();

         if (taskParameters.config.joinedMeta && !taskParameters.config.commonIcons) {
            taskParameters.config.commonIcons = {};
         }

         const currentPackagesMeta = moduleInfo.cache.getCurrentSvgPackagesMeta();
         const lastPackagesMeta = moduleInfo.cache.getLastSvgPackagesMeta();
         const iconsMeta = {
            module: moduleInfo.name,
            description: moduleInfo.description,
            packages: []
         };

         Object.keys(currentPackagesMeta).forEach((currentPackage) => {
            iconsMeta.packages.push({
               name: currentPackage,
               icons: currentPackagesMeta[currentPackage].map(icon => path.basename(icon.path, '.svg')).sort()
            });

            const shouldProcess = (
               packagesToBuild.includes(currentPackage) ||
               (
                  lastPackagesMeta[currentPackage] &&
                  lastPackagesMeta[currentPackage].length !== currentPackagesMeta[currentPackage].length
               )
            );

            if (!shouldProcess) {
               return;
            }

            const currentResult = ['<svg xmlns="http://www.w3.org/2000/svg">'];
            const packageName = `${path.basename(moduleInfo.output)}/${currentPackage}.svg`;

            helpers.descendingSort(currentPackagesMeta[currentPackage], 'path').forEach((currentSvg) => {
               const fileName = path.basename(currentSvg.path, '.svg');
               let optimizedSvg;

               if (currentSvg.content.skipClean) {
                  optimizedSvg = replaceSvgTagWithSymbol(currentSvg.content.content, fileName);
               } else {
                  optimizedSvg = optimize(currentSvg.content.content, getSvgoOptions(fileName));
               }

               currentResult.push(`<svg>${optimizedSvg.data}</svg>`);

               taskParameters.cache.addOutputFile(path.dirname(currentSvg.path), packageName, moduleInfo);
            });

            currentResult.push('</svg>');

            const fileName = `${currentPackage}.svg`;
            const resultContent = currentResult.join('');
            this.push(new PosixVinyl({
               pPath: fileName,
               contents: Buffer.from(resultContent),
               moduleInfo
            }));
         });

         iconsMeta.packages = helpers.descendingSort(iconsMeta.packages, 'name');
         const sortedIconsMeta = JSON.stringify(iconsMeta);

         this.push(
            new PosixVinyl({
               pPath: 'icons.json',
               contents: Buffer.from(sortedIconsMeta),
               moduleInfo,
               compiled: true
            })
         );

         if (taskParameters.config.isReleaseMode) {
            this.push(
               new PosixVinyl({
                  pPath: 'icons.min.json',
                  contents: Buffer.from(sortedIconsMeta),
                  moduleInfo,
                  compiled: true
               })
            );
         }

         if (taskParameters.config.joinedMeta) {
            taskParameters.config.commonIcons[moduleInfo.name] = iconsMeta;
         }

         taskParameters.metrics.storePluginTime('process svg', startTime);
         callback();
      }
   );
}

module.exports = {
   processSvg,
   getIconSizeByViewBox
};
