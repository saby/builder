/**
 * Плагин для паковки собственных зависимостей.
 * В js компоненты добавляется код собранных tmpl и xhtml из зависимостей.
 * Сильно влияет на плагин minify-js
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2');
const logger = require('../../../lib/logger').logger();
const pMap = require('p-map');
const fs = require('fs-extra');
const transliterate = require('../../../lib/transliterate');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   // js файлы можно паковать только после сборки xhtml, tmpl и wml файлов.
   // поэтому переместим обработку в самый конец
   const jsFiles = [];

   return through.obj(
      function onTransform(file, encoding, callback) {
         if (file.pExtname !== '.js' || file.library) {
            callback(null, file);
         } else {
            jsFiles.push(file);
            callback();
         }
      },

      /* @this Stream */
      async function onFlush(callback) {
         const startTime = Date.now();

         try {
            const componentsInfo = moduleInfo.cache.getComponentsInfo();
            const markupCache = moduleInfo.cache.getMarkupCache();
            const nodenameToMarkup = new Map();
            for (const relativePath of Object.keys(markupCache)) {
               const markupObj = markupCache[relativePath];
               if (markupObj) {
                  nodenameToMarkup.set(markupObj.nodeName, {
                     text: markupObj.text,
                     versioned: markupObj.versioned,
                     filePath: relativePath
                  });
               }
            }
            const getRelativePathInSource = (dep) => {
               const moduleNameOutput = path.basename(moduleInfo.output);
               let relativeFileName = '';
               if (dep.startsWith('html!')) {
                  relativeFileName = `${relativeFileName.replace('html!', '')}.xhtml`;
               } else if (dep.startsWith('tmpl!')) {
                  relativeFileName = `${relativeFileName.replace('tmpl!', '')}.tmpl`;
               } else {
                  relativeFileName = `${relativeFileName.replace('wml!', '')}.wml`;
               }

               // return filePath only if it's an own dependency(also in the same interface module)
               if (relativeFileName.startsWith(moduleNameOutput)) {
                  return relativeFileName;
               }
               return '';
            };

            await pMap(
               jsFiles,
               async(jsFile) => {
                  // важно сохранить в зависимости для js все файлы, которые должны приводить к пересборке файла
                  const filesDepsForCache = new Set();
                  const ownDeps = [];
                  const prettyRelativePath = path.join(moduleInfo.name, jsFile.pRelative);
                  const normalizedRelativePath = jsFile.compiled ? prettyRelativePath.replace('.js', '.ts') : prettyRelativePath;
                  if (componentsInfo.hasOwnProperty(normalizedRelativePath)) {
                     const componentInfo = componentsInfo[normalizedRelativePath];
                     if (componentInfo.componentName && componentInfo.componentDep) {
                        for (const dep of componentInfo.componentDep) {
                           if (dep.startsWith('html!') || dep.startsWith('tmpl!') || dep.startsWith('wml!')) {
                              ownDeps.push(dep);
                              const fullPath = getRelativePathInSource(dep);
                              if (fullPath) {
                                 filesDepsForCache.add(fullPath);
                              }
                           }
                        }
                     }
                  }
                  if (ownDeps.length > 0) {
                     const modulepackContent = [];
                     const minifiedTemplatesToPack = [];
                     let hasCdnLinkedMarkup = false;
                     await pMap(
                        ownDeps,
                        async(dep) => {
                           if (nodenameToMarkup.has(dep)) {
                              const markupObj = nodenameToMarkup.get(dep);
                              filesDepsForCache.add(markupObj.filePath);

                              /**
                               * markup cache has text only if cached file was compiled in current build.
                               * Otherwise we need to get compiled file from output directory instead of storing
                               * it in cache due to huge amount of templates to store in project such as specification
                               * e.g. storing templates of "Specs" module in specifications project will increase size
                               * of Specs.json cache meta up to 250Mb or higher that leads to Heap out of memory errors
                               * 1 time out of 4-7 builds
                               */
                              if (!markupObj.text) {
                                 const extReg = new RegExp(`(\\.min)?(\\${path.extname(markupObj.filePath)})$`);
                                 const normalizedPath = transliterate(markupObj.filePath.replace(extReg, '.min$2'));

                                 markupObj.text = await fs.readFile(
                                    path.join(path.dirname(moduleInfo.output), normalizedPath),
                                    'utf8'
                                 );
                              }

                              minifiedTemplatesToPack.push(markupObj.text);

                              if (markupObj.cdnLinked) {
                                 hasCdnLinkedMarkup = true;
                              }
                           }
                        }
                     );

                     if (modulepackContent.length > 0 || minifiedTemplatesToPack.length > 0) {
                        modulepackContent.push(jsFile.contents.toString());
                        jsFile.modulepack = modulepackContent.join('\n');
                        if (minifiedTemplatesToPack.length > 0) {
                           jsFile.minifiedTemplatesToPack = minifiedTemplatesToPack;
                        }
                     }

                     if (hasCdnLinkedMarkup) {
                        jsFile.cdnLinked = true;
                     }
                  }
                  if (filesDepsForCache.size > 0) {
                     taskParameters.cache.addDependencies(
                        moduleInfo.appRoot,
                        normalizedRelativePath,
                        [...filesDepsForCache]
                     );
                  }
                  this.push(jsFile);
               }
            );
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }

         taskParameters.metrics.storePluginTime('own dependencies packer', startTime);
         callback(null);
      }
   );
};
