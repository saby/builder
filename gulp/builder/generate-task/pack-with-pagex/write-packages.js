/**
 * @author Krylov M.A.
 */
'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');

const { path } = require('../../../../lib/platform/path');
const { writeJsonArtifact } = require('./utils');
const generateRouterContent = require('../../../../lib/pagex/router');

const output = {
   'layouts': 'SabyPageLayoutPackages',
   'contents': 'SabyPageContentPackages'
};

function generateStylesPreamble(kind, styles, stylesRtl, resourceDir) {
   if (kind !== 'scripts') {
      return '';
   }

   const isRtlDef = 'var isRtl = typeof document !== "undefined" && document.cookie && (document.cookie.indexOf("lang=ar") !== -1 || document.cookie.indexOf("lang=he") !== -1);';
   const toModuleName = filePath => filePath.replace(/(\.min)?\.css$/i, '');
   const toDefine = filePath => `define("css!${toModuleName(filePath).replace(/(\.rtl)?$/i, '')}", ["css!${path.join(resourceDir, 'styles')}"], "");`;
   const styleDefines = styles.map(toDefine).join('');

   if (stylesRtl.length > 0) {
      const toDefineRtl = filePath => `define("css!${toModuleName(filePath).replace(/(\.rtl)?$/i, '')}", ["css!${path.join(resourceDir, 'styles.rtl')}"], "");`;
      const styleRtlDefines = stylesRtl.map(toDefineRtl).join('');

      if (styles.length > 0) {
         // if and else
         return `(function(){${isRtlDef}if(isRtl){${styleRtlDefines}}else{${styleDefines}}})();`;
      }

      // if only
      return `(function(){${isRtlDef}if(isRtl){${styleRtlDefines}}})();`;
   }

   if (styles.length > 0) {
      // negative if
      return `(function(){${isRtlDef}if(!isRtl){${styleDefines}}})();`;
   }

   // none
   return '';
}

function createRouterMap() {
   return {
      rtlLocales: ['ar', 'he'],
      layouts: {
         common: { },
         packages: new Map()
      },
      contents: {
         common: { },
         packages: new Map()
      },
      putCommonValue(type, group, kind, value) {
         this[type][group][kind] = value;
      },
      putPackageValue(type, group, kind, name, value) {
         if (!this[type][group].has(name)) {
            this[type][group].set(name, { });
         }

         this[type][group].get(name)[kind] = value;
      }
   };
}

async function readFiles(dirPath, filePaths, fsCache) {
   const result = {
      resolved: [],
      unresolved: []
   };

   const promises = filePaths.map(async(filePath) => {
      if (fsCache.has(filePath)) {
         result.resolved.push(filePath);

         return;
      }

      const fullFilePath = path.join(dirPath, filePath);

      if (await fs.pathExists(fullFilePath)) {
         result.resolved.push(filePath);

         fsCache.set(filePath, await fs.readFile(fullFilePath, 'utf-8'));

         return;
      }

      result.unresolved.push(filePath);
   });

   await Promise.all(promises);

   return result;
}

function generateWriteSourcePackages(taskParameters, workspace) {
   async function writePackage(fsCache, inputFiles, outputFile, preamble = '') {
      if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
         return null;
      }

      const outputFiles = await readFiles(
         workspace.outputDirPath,
         inputFiles,
         fsCache
      );

      const contents = outputFiles.resolved.map(filePath => fsCache.get(filePath)).join('\n');

      await fs.mkdir(path.dirname(outputFile), { recursive: true });

      await fs.writeFile(outputFile, preamble + contents, 'utf-8');

      return outputFiles;
   }

   async function writePackageKind(kind, fileName) {
      const fsCache = new Map();

      let result;
      for await (const property of Object.keys(output)) {
         result = await writePackage(
            fsCache,
            workspace.filesDistribution[property].common[kind],
            path.join(workspace.outputDirPath, output[property], 'common', fileName),
            generateStylesPreamble(
               kind,
               workspace.filesDistribution[property].common.styles,
               workspace.filesDistribution[property].common.stylesRtl,
               path.join(output[property], 'common')
            )
         );

         if (result) {
            workspace.routerMap.putCommonValue(
               property,
               'common',
               kind,
               [
                  path.join(workspace.resourcesUrl, output[property], 'common', fileName)
               ]
            );
         }

         for await (const [key, value] of workspace.filesDistribution[property].packages) {
            result = await writePackage(
               fsCache,
               value[kind],
               path.join(workspace.outputDirPath, output[property], 'packages', key, fileName),
               generateStylesPreamble(
                  kind,
                  value.styles,
                  value.stylesRtl,
                  path.join(output[property], 'packages', key)
               )
            );

            if (result) {
               workspace.routerMap.putPackageValue(
                  property,
                  'packages',
                  kind,
                  key,
                  [
                     path.join(workspace.resourcesUrl, output[property], 'packages', key, fileName)
                  ]
               );
            }
         }
      }

      fsCache.clear();
   }

   async function writeLocales() {
      const fsCache = new Map();

      let result;
      for await (const property of Object.keys(output)) {
         if (workspace.filesDistribution[property].common.locales) {
            const { locales } = workspace.filesDistribution[property].common;
            const outputDir = path.join(output[property], 'common', 'lang');

            let routerMapValue;
            for await (const locale of Object.keys(locales)) {
               if (locales.hasOwnProperty(locale)) {
                  result = await writePackage(
                     fsCache,
                     locales[locale],
                     path.join(workspace.outputDirPath, outputDir, `${locale}.json.min.js`)
                  );

                  if (result) {
                     if (!routerMapValue) {
                        routerMapValue = { };
                     }

                     routerMapValue[locale] = [
                        path.join(workspace.resourcesUrl, outputDir, `${locale}.json.min.js`)
                     ];
                  }
               }
            }

            if (routerMapValue) {
               workspace.routerMap.putCommonValue(
                  property,
                  'common',
                  'locales',
                  routerMapValue
               );
            }
         }

         for await (const [key, value] of workspace.filesDistribution[property].packages) {
            if (property === 'contents') {
               workspace.routerMap.putPackageValue(
                  property,
                  'packages',
                  'layout',
                  key,
                  workspace.registry.pages.get(key).type
               );
            }

            if (!value.locales) {
               continue;
            }

            const outputDir = path.join(output[property], 'packages', key, 'lang');

            let routerMapValue;
            for await (const locale of Object.keys(value.locales)) {
               if (value.locales.hasOwnProperty(locale)) {
                  result = await writePackage(
                     fsCache,
                     value.locales[locale],
                     path.join(workspace.outputDirPath, outputDir, `${locale}.json.min.js`)
                  );

                  if (result) {
                     if (!routerMapValue) {
                        routerMapValue = { };
                     }

                     routerMapValue[locale] = [
                        path.join(workspace.resourcesUrl, outputDir, `${locale}.json.min.js`)
                     ];
                  }
               }
            }

            if (routerMapValue) {
               workspace.routerMap.putPackageValue(
                  property,
                  'packages',
                  'locales',
                  key,
                  routerMapValue
               );
            }
         }
      }

      fsCache.clear();
   }

   return function writeSourcePackages() {
      return Promise.all([
         writePackageKind('styles', 'styles.min.css'),
         writePackageKind('stylesRtl', 'styles.rtl.min.css'),
         writePackageKind('scripts', 'scripts.min.js'),
         writeLocales()
      ]);
   };
}

function generateSaveRouterArtifact(taskParameters, workspace) {
   return async function saveRouterArtifact() {
      await writeJsonArtifact(
         path.join(workspace.cachePath, 'router.json'),
         workspace.routerMap
      );

      const sourceText = await generateRouterContent(
         'SabyPageContentPackages/getPageResources',
         workspace.routerMap.rtlLocales,
         workspace.routerMap.layouts,
         workspace.routerMap.contents
      );

      await fs.writeFile(
         path.join(workspace.outputDirPath, 'SabyPageContentPackages', 'getPageResources.js'),
         sourceText,
         'utf-8'
      );

      await fs.writeFile(
         path.join(workspace.outputDirPath, 'SabyPageContentPackages', 'getPageResources.min.js'),
         sourceText,
         'utf-8'
      );
   };
}

function generateWritePackages(taskParameters, workspace) {
   workspace.outputDirPath = taskParameters.config.rawConfig.output;
   workspace.routerMap = createRouterMap();

   return gulp.series(
      generateWriteSourcePackages(taskParameters, workspace),
      generateSaveRouterArtifact(taskParameters, workspace)
   );
}

module.exports = generateWritePackages;
