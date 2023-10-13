'use strict';

const {
   path,
   toSafePosix,
   toPosix,
   removeLeadingSlashes
} = require('../../lib/platform/path');
const commonPackage = require('../../packer/lib/common-package'),
   fs = require('fs-extra'),
   logger = require('../../lib/logger').logger(),
   packerDictionary = require('../../packer/tasks/lib/pack-dictionary'),
   packHelpers = require('./helpers/custompack'),
   pMap = require('p-map'),
   helpers = require('../../lib/helpers'),
   cssHelpers = require('../../packer/lib/css-helpers'),
   builderConstants = require('../../lib/builder-constants'),
   transliterate = require('../../lib/transliterate'),
   { normalizeModuleName } = require('../modulepath-to-require'),
   SOURCE_MAPS_REGEX = /\n\/\/# sourceMappingURL=.+?\.js\.map/g;

const { convertModulesToBeLazy } = require('../espree/convert-to-lazy-module');

const REQUIRE_JS_PLUGINS_TO_PACK = [
   ...builderConstants.requirejsPlugins,
   'browser',
   'cdn',
   'is',
   'is-api',
   'native-css',
   'preload'
];

// interface modules which bundles meta must be saved
// even in desktop application for proper requiring of
// them in desktop applications
const ALLOWED_BUNDLES_META_MODULES = [
   'Superbundles',
   'RequireJsLoader',
   'RetailOffline',
   'SBISPluginBase'
];

async function rebaseCSS(css, appRoot, relativePackagePath) {
   if (await fs.pathExists(css)) {
      const content = await fs.readFile(css);
      return cssHelpers.rebaseUrls({
         root: appRoot,
         sourceFile: css,
         css: content.toString(),
         relativePackagePath
      });
   }
   logger.info(`ENOENT: no such css style to pack: ${css}`);
   return '';
}

async function customPackCSS(config, files, root, relativePackagePath) {
   let filesToPack = [];
   const cssResults = {};
   files.forEach((currentCss) => {
      const normalizedCss = currentCss.replace(/(\.rtl)(\.min)?.css$/, '$2.css');
      if (!filesToPack.includes(normalizedCss)) {
         filesToPack.push(normalizedCss);
      }
   });
   filesToPack = filesToPack.sort();

   const results = await pMap(
      filesToPack,
      async(css) => {
         const result = await rebaseCSS(css, root, relativePackagePath);
         return result;
      },
      {
         concurrency: 10
      }
   );
   cssResults.common = results.join('\n');

   if (config.buildRtl) {
      const resultsForRtl = await pMap(
         filesToPack,
         async(css) => {
            const result = await rebaseCSS(css.replace(/(\.min)\.css$/, '.rtl$1.css'), root, relativePackagePath);
            return result;
         },
         {
            concurrency: 10
         }
      );
      cssResults.rtl = resultsForRtl.join('\n');
   }

   return cssResults;
}

async function writeCustomPackage(
   packageConfig,
   root,
   application,
   taskParameters
) {
   const
      originalFilePath = packHelpers.originalPath(packageConfig.outputFile),
      currentFileExists = await fs.pathExists(packageConfig.outputFile),
      currentPackageLockFileExists = await fs.pathExists(`${packageConfig.outputFile}.lockfile`),
      prettyPackagePath = toPosix(packageConfig.outputFile),
      prettyRelativePackagePath = prettyPackagePath.replace(`${root}/${packageConfig.moduleName}/`, ''),
      originalFileExists = await fs.pathExists(packHelpers.originalPath(packageConfig.outputFile));

   // save a sign that current package is private. Needed for incremental custom pack to determine
   // whether package is private to pack css package properly
   if (packageConfig.isPrivatePackage) {
      await fs.outputFile(`${packageConfig.outputFile}.private`, '');
      taskParameters.addFileToCopy(packageConfig.moduleName, `${prettyRelativePackagePath}.private`);
   }

   // write .min.original file only if it's a first pack of current custom package that has
   // an existing module as a package output
   if (currentFileExists && !originalFileExists && !currentPackageLockFileExists) {
      const prettyPath = toPosix(originalFilePath);
      await fs.copy(packageConfig.outputFile, originalFilePath);
      taskParameters.addFileToCopy(
         packageConfig.moduleName,
         prettyPath.replace(`${root}/${packageConfig.moduleName}/`, '')
      );
   }
   await fs.outputFile(`${packageConfig.outputFile}.lockfile`, '');
   taskParameters.addFileToCopy(packageConfig.moduleName, `${prettyRelativePackagePath}.lockfile`);

   const modulesContent = await commonPackage.limitingNativePackFiles(
      packageConfig,
      root,
      application,
      taskParameters
   );

   /**
    * Отсортируем контент модулей по именам модулей,
    * чтобы между двумя дистрами не было разницы в случае
    * одинакового набора модулей пакета.
    * @type {string[]}
    */
   const listOfModules = new Set(helpers.descendingSort(Object.keys(modulesContent)));
   let result = [];
   let mDepsForDebugNeeded = false;
   if (listOfModules.size > 0) {
      listOfModules.forEach((currentModule) => {
         if (result.includes(modulesContent[currentModule])) {
            logger.warning(`Attempt to push duplicate code of module ${currentModule}: ${modulesContent[currentModule]}`);
            mDepsForDebugNeeded = true;
         } else {
            result.push(modulesContent[currentModule]);
         }
      });
   }

   if (mDepsForDebugNeeded) {
      await fs.outputJson(`${packageConfig.outputFile}.debug.json`, taskParameters.cache.getModuleDependencies());
   }

   if (packageConfig.cssModulesFromOrderQueue.length > 0) {
      result.unshift(
         packHelpers.generateLinkForCss(
            taskParameters,
            packageConfig.cssModulesFromOrderQueue,
            packageConfig.packagePath
         )
      );
   } else if (listOfModules.size === 0) {
      // there could be an empty result for superbundles, do nothing then, because
      // superbundles can contain interface modules that aren't in a current project.
      // In all other cases we should throw an Error that there is no content
      // for current custom package.
      if (!packageConfig.includePackages) {
         /**
          * если в качестве результата нам вернулась пустая строка и при этом
          * полностью отсутствуют стили на запись в кастомный пакет, значит,
          * скорее всего, создатели неправильно описали правила паковки
          */
         throw new Error('There is an empty result for a current custom package. Check your .package.json for a valid packing rules');
      }
      helpers.removeFileFromBuilderMeta(
         taskParameters.getCdnModules(packageConfig.moduleName),
         `${packageConfig.packagePath}.js`
      );
      return;
   }

   if (packageConfig.optimized) {
      const lazyResult = convertModulesToBeLazy(taskParameters, result, packageConfig.packagePath);
      result = lazyResult.resultCode;

      // store all meta about generated lazy bundle, it's essential info to check for cycles
      taskParameters.addLazyBundle(
         packageConfig.packagePath,
         lazyResult.externalDependencies,
         lazyResult.internalModules
      );
   }
   await fs.outputFile(
      packageConfig.outputFile,
      result ? result.reduce((res, modContent) => {
         let normalizedModContent;

         // replace useless sourcemap urls in custom packages, sourcemaps
         // works only in single modules
         if (taskParameters.config.sourceMaps) {
            normalizedModContent = modContent.replace(SOURCE_MAPS_REGEX, '');
         } else {
            normalizedModContent = modContent;
         }
         return res + (res ? '\n' : '') + normalizedModContent;
      }) : ''
   );
}

function checkConfigForIncludeOption(config) {
   return config.includeCore || (config.include && config.include.length > 0);
}

function removePackedStyle(taskParameters, root, relativePath, outputFile, moduleName, packageConfig, fullPath) {
   const currentFileModuleName = relativePath.split('/').shift();
   const prettyCssOutput = path.join(root, relativePath);
   const cssIsPackageOutput = prettyCssOutput === outputFile.replace(/\.js$/, '.css');

   /**
    * 1) Style that is used as custom package result can't be further removed.
    * 2) All styles can be removed only within interface module of current
    * custom package
    */
   if (
      !taskParameters.config.sources &&
      !cssIsPackageOutput &&
      currentFileModuleName === moduleName
   ) {
      if (!taskParameters.packedFiles.has(prettyCssOutput)) {
         taskParameters.packedFiles.add(prettyCssOutput);
         const removeMessage = `Style ${fullPath} will not be copied into output folder in namespace of Interface module ${moduleName}.` +
            `Packed into ${packageConfig.output}`;
         logger.debug(removeMessage);
         helpers.removeFileFromBuilderMeta(
            taskParameters.getVersionedModules(moduleName),
            fullPath
         );
         helpers.removeFileFromBuilderMeta(
            taskParameters.getCdnModules(moduleName),
            fullPath
         );
      }
   }
}

/**
 * if module was packed into package, we must remove excluded css with the same name as module
 * from excluded css meta
 */
function removeFromExcludedCss(excludedCSS, result, metaName, bundlePath) {
   Object.keys(excludedCSS).forEach((currentKey) => {
      const nodeName = currentKey.split(/!|\?/).pop();
      if (!result[metaName][bundlePath].includes(nodeName)) {
         delete excludedCSS[currentKey];
      }
   });
}

async function generateCustomPackage(
   depsTree,
   root,
   application,
   packageConfig,
   taskParameters
) {
   const
      availableLanguage = taskParameters.config.localizations,
      applicationRoot = path.join(root, application),
      outputFile = packHelpers.getOutputFile(packageConfig, applicationRoot, depsTree),
      packagePath = packHelpers.getBundlePath(outputFile, applicationRoot),
      moduleName = packagePath.split('/')[0],
      relativePackagePath = packagePath.replace(`${moduleName}/`, ''),
      pathToCustomCSS = outputFile.replace(/(\.package)?(\.min)?\.js$/, ''),
      cssExtIncludesPackage = outputFile.replace(/(\.min)?\.js$/, '').endsWith('.package'),
      { resourcesUrl } = taskParameters.config,
      result = {
         bundles: {},
         bundlesRoute: {},
         optionalBundles: {},
         excludedCSS: {},
         superBundles: {},
         moduleNames: [moduleName]
      },
      excludedCSS = {};

   let
      cssModulesFromOrderQueue = [],
      bundlePath = removeLeadingSlashes(packagePath),
      orderQueue;

   result.bundlePath = `${bundlePath}.js`;

   if (resourcesUrl) {
      bundlePath = `resources/${bundlePath}`;
   }
   if (!checkConfigForIncludeOption(packageConfig)) {
      throw new Error('Конфиг для кастомного пакета должен содержать опцию include для нового вида паковки.');
   }

   packageConfig.moduleName = moduleName;
   packageConfig.outputFile = outputFile;
   orderQueue = packHelpers.getOrderQueue(
      depsTree,
      packageConfig,
      excludedCSS,
      applicationRoot
   ).filter((node) => {
      const fullPath = node.moduleYes ? node.moduleYes.fullPath : node.fullPath;
      const relativePath = removeLeadingSlashes(
         fullPath.replace(applicationRoot, '')
      );
      const currentFileModuleName = relativePath.split('/').shift();

      if (node.provider) {
         taskParameters.addIntoInterfaceRoute(
            taskParameters.config.getInterfaceByProvider(node.fullName),
            `${packagePath}.js`
         );
      }

      if (node.plugin === 'js' || node.plugin === 'tmpl' || node.plugin === 'html' || node.plugin === 'wml') {
         commonPackage.removePackedModule(
            taskParameters,
            root,
            relativePath,
            fullPath,
            packageConfig,
            currentFileModuleName
         );

         if (node.amd && !result.moduleNames.includes(currentFileModuleName)) {
            result.moduleNames.push(currentFileModuleName);
         }
         return node.amd;
      }

      if (node.fullName.includes('css!')) {
         removePackedStyle(
            taskParameters,
            root,
            relativePath,
            outputFile,
            currentFileModuleName,
            packageConfig,
            fullPath
         );

         cssModulesFromOrderQueue.push(node);
         if (!result.moduleNames.includes(currentFileModuleName)) {
            result.moduleNames.push(currentFileModuleName);
         }
         return false;
      }
      return true;
   });

   taskParameters.addCdnModule(moduleName, `${packagePath}.js`);
   if (cssModulesFromOrderQueue.length > 0) {
      taskParameters.addVersionedModule(moduleName, `${packagePath}.css`);
      taskParameters.addCdnModule(moduleName, `${packagePath}.css`);

      if (taskParameters.config.buildRtl) {
         taskParameters.addVersionedModule(moduleName, `${packagePath.replace(/(\.min)?$/, '.rtl$1')}.css`);
         taskParameters.addCdnModule(moduleName, `${packagePath.replace(/(\.min)?$/, '.rtl$1')}.css`);
      }
   }

   taskParameters.addFileToCopy(moduleName, `${relativePackagePath}.js`);
   if (cssModulesFromOrderQueue.length > 0) {
      taskParameters.addFileToCopy(moduleName, `${relativePackagePath}.css`);

      if (taskParameters.config.buildRtl) {
         taskParameters.addFileToCopy(moduleName, `${relativePackagePath.replace(/(\.min)?$/, '.rtl$1')}.css`);
      }
   }
   packageConfig.moduleOutput = toSafePosix(path.join(applicationRoot, moduleName));

   /**
    * пишем все стили по пути кастомного пакета в css-файл.
    */
   cssModulesFromOrderQueue = commonPackage.prepareResultQueue(
      cssModulesFromOrderQueue,
      applicationRoot,
      availableLanguage
   );
   const prettifiedRoot = toSafePosix(applicationRoot);
   if (cssModulesFromOrderQueue.css.length > 0) {
      const cssExternalModuleUsageMessages = new Set();

      const cssRes = await customPackCSS(
         taskParameters.config,
         cssModulesFromOrderQueue.css
            .map(function onlyPath(currentCss) {
               const cssFullPath = currentCss.moduleYes ? currentCss.moduleYes.fullPath : currentCss.fullPath;
               const relativeCss = removeLeadingSlashes(
                  cssFullPath.replace(prettifiedRoot, '')
               );
               const cssName = relativeCss.replace('.min.css', '');
               const currentFileModuleName = cssName.split('/').shift();
               removePackedStyle(
                  taskParameters,
                  root,
                  relativeCss,
                  outputFile,
                  currentFileModuleName,
                  packageConfig,
                  cssFullPath
               );

               if (
                  currentFileModuleName !== moduleName &&
                  packageConfig.moduleInfo &&
                  !packageConfig.moduleInfo.fullDependsTree.includes(currentFileModuleName)
               ) {
                  const message = `External interface module "${currentFileModuleName}" usage in custom package(styles).` +
                     'Check for it existance in current interface module dependencies';
                  cssExternalModuleUsageMessages.add(message);
               }

               return cssFullPath;
            }),
         root,
         packagePath
      );
      const cssOutputFile = `${pathToCustomCSS}${cssExtIncludesPackage ? '.package' : ''}.min.css`;
      await fs.outputFile(cssOutputFile, cssRes.common);

      if (cssRes.hasOwnProperty('rtl')) {
         const cssOutputFileForRtl = `${pathToCustomCSS}${cssExtIncludesPackage ? '.package' : ''}.rtl.min.css`;
         await fs.outputFile(cssOutputFileForRtl, cssRes.rtl);
      }

      cssExternalModuleUsageMessages.forEach(message => logger.error({
         message,
         filePath: packageConfig.path,
         moduleInfo: packageConfig.moduleInfo
      }));
   }

   /**
    * Чистим всю локализацию до формирования bundles и bundlesRoute
    * @type {Array}
    */
   // в опциональных супербандлах нужно паковать и локализацию.
   if (!packageConfig.optional) {
      orderQueue = packerDictionary.deleteModulesLocalization(orderQueue);
   }
   if (packageConfig.platformPackage || !packageConfig.includeCore) {
      const bundleList = (await packHelpers.generateBundle(
         orderQueue,
         cssModulesFromOrderQueue.css
      )).sort();
      const cssBundlePath = pathToCustomCSS.replace(applicationRoot, '');
      if (!packageConfig.optional) {
         result.bundles[bundlePath] = bundleList;
         result.bundlesRoute = packHelpers.generateBundlesRouting(
            result.bundles[bundlePath],
            bundlePath,
            {
               cssExtIncludesPackage,
               cssBundlePath,
               excludedCSS,
               resourcesUrl,
               superBundles: result.superBundles,
               isSuperBundle: !!packageConfig.includePackages
            }
         );
         removeFromExcludedCss(excludedCSS, result, 'bundles', bundlePath);
      } else {
         result.optionalBundles[bundlePath] = bundleList;
         removeFromExcludedCss(excludedCSS, result, 'optionalBundles', bundlePath);
      }
   } else {
      packageConfig.isPrivatePackage = true;
   }

   packageConfig.orderQueue = orderQueue;
   packageConfig.packagePath = packagePath;
   packageConfig.cssModulesFromOrderQueue = cssModulesFromOrderQueue.css;
   result.output = packageConfig.outputFile;
   result.excludedCSS = excludedCSS;
   await writeCustomPackage(
      packageConfig,
      root,
      application,
      taskParameters
   );
   return result;
}

/**
 * Сортируем объект по его ключам
 * @param currentObject
 */
function sortObjectByKeys(currentObject) {
   const result = {};
   Object.keys(currentObject).sort().forEach((currentProperty) => {
      result[currentProperty] = currentObject[currentProperty];
   });
   return result;
}

/**
 * Сохраняем общие результаты паковки(bundles и bundlesRoute) в корень приложения
 * @returns {Promise<void>}
 */
async function saveRootBundlesMeta(taskParameters, root, result) {
   // паковка вызывается только в релизе, поэтому сохраняем .min
   await fs.writeFile(
      path.join(root, 'bundles.min.js'),
      `bundles=${JSON.stringify(sortObjectByKeys(result.bundles))}`
   );
   await fs.writeJson(
      path.join(root, 'bundles.json'),
      sortObjectByKeys(result.bundles)
   );
   await fs.writeJson(
      path.join(root, 'bundlesRoute.json'),
      sortObjectByKeys(result.bundlesRoute)
   );
}

/**
 * Функция, которая сплитит результат работы таски custompack в секции bundles
 */
async function saveBundlesForEachModule(taskParameters, applicationRoot, result) {
   const jsonToWrite = {};

   /**
    * dont save bundlesRoute if sources flag disabled. There is no need in usage
    * of this meta in desktop applications.
    */
   const superBundles = Object.keys(result.superBundles);
   Object.keys(result.bundlesRoute).forEach((currentModule) => {
      const
         moduleNameWithoutPlugins = normalizeModuleName(currentModule.split(/!|\?/).pop());

      let intModuleName;

      // for superbundles and requirejs plugins calculate module name by module where it's packed
      // instead of module with custom package configuration
      if (
         superBundles.includes(result.bundlesRoute[currentModule]) ||
         REQUIRE_JS_PLUGINS_TO_PACK.includes(currentModule)
      ) {
         [, , intModuleName] = result.bundlesRoute[currentModule].match(/(^resources\/)?([^/]+)/);
      } else if (moduleNameWithoutPlugins.includes('/')) {
         intModuleName = moduleNameWithoutPlugins.split('/').shift();
      } else {
         // single-named modules is requirejs plugins, in this case write results to WS.Core
         intModuleName = 'WS.Core';
      }

      const bundlesRoutePath = path.normalize(path.join(applicationRoot, intModuleName, 'bundlesRoute.json'));

      if (!jsonToWrite[bundlesRoutePath]) {
         jsonToWrite[bundlesRoutePath] = {};
      }

      if (!result.excludedCSS.hasOwnProperty(currentModule)) {
         if (jsonToWrite[bundlesRoutePath].hasOwnProperty(currentModule)) {
            jsonToWrite[bundlesRoutePath][currentModule].concat(result.bundlesRoute[currentModule]);
         } else {
            jsonToWrite[bundlesRoutePath][currentModule] = result.bundlesRoute[currentModule];
         }
      }
      jsonToWrite[bundlesRoutePath][currentModule] = result.bundlesRoute[currentModule];
      taskParameters.addFileToCopy(intModuleName, 'bundlesRoute.json');
   });

   // function to process meta of current bundle
   const processBundleMeta = async(currentBundle, bundleMetaName, contentsMetaName, saveBundlesInOutput) => {
      const intModuleName = currentBundle.match(/(^resources\/)?([^/]+)/)[2];
      const bundlesPath = path.normalize(path.join(applicationRoot, intModuleName, `${bundleMetaName}.json`));
      const contentsPath = path.normalize(path.join(applicationRoot, intModuleName, 'contents.json'));

      if (await fs.pathExists(bundlesPath)) {
         jsonToWrite[bundlesPath] = await fs.readJson(bundlesPath);
      }

      if (taskParameters.config.joinedMeta && taskParameters.config.contents) {
         // store meta about bundles in contents, so require.js
         // can know there are packages in this interface module
         taskParameters.config.commonContents.modules[intModuleName][contentsMetaName] = true;
      }

      if (await fs.pathExists(contentsPath)) {
         const contentsJsPath = `${contentsPath}.js`;
         const contentsMinJsPath = `${contentsPath}.min.js`;
         jsonToWrite[contentsPath] = jsonToWrite[contentsPath] || await fs.readJson(contentsPath);
         jsonToWrite[contentsPath].modules[intModuleName][contentsMetaName] = true;
         const jsContents = helpers.generateContentsContent(
            intModuleName,
            JSON.stringify(jsonToWrite[contentsPath]),
            taskParameters.config.generateUMD
         );
         jsonToWrite[contentsJsPath] = jsContents;
         jsonToWrite[contentsMinJsPath] = jsContents;
      }

      if (!jsonToWrite[bundlesPath]) {
         jsonToWrite[bundlesPath] = {};
      }

      // add bundles for certain modules in desktop applications
      if (saveBundlesInOutput) {
         jsonToWrite[bundlesPath][currentBundle] = result[bundleMetaName][currentBundle];
      }
      taskParameters.addFileToCopy(intModuleName, `${bundleMetaName}.json`);
      if (bundleMetaName === 'optionalBundles') {
         taskParameters.addFileToCopy(intModuleName, `${bundleMetaName}.min.js`);
      }
   };

   /**
    * write bundles meta by interface modules names.
    */
   await pMap(
      Object.keys(result.bundles),
      async(currentBundle) => {
         const intModuleName = currentBundle.match(/(^resources\/)?([^/]+)/)[2];
         await processBundleMeta(
            currentBundle,
            'bundles',
            'hasBundles',
            ALLOWED_BUNDLES_META_MODULES.includes(intModuleName)
         );
      },
      {
         concurrency: 10
      }
   );

   await pMap(
      Object.keys(result.optionalBundles),
      async(currentBundle) => {
         await processBundleMeta(
            currentBundle,
            'optionalBundles',
            'hasOptionalBundles',
            true
         );
      },
      {
         concurrency: 10
      }
   );

   await pMap(Object.keys(jsonToWrite), async(key) => {
      // save meta if there is anything to save
      if (Object.keys(jsonToWrite[key]).length > 0) {
         const fileName = path.basename(key);
         if (fileName === 'bundlesRoute.json') {
            const moduleName = path.basename(path.dirname(key));

            // store package map and updates contents meta only if there are any custom packages in current
            // interface module
            await storePackageMap(taskParameters, applicationRoot, moduleName, sortObjectByKeys(jsonToWrite[key]));

            // dont save bundlesRoute in desktop application, it's only needed to save packageMap.
            if (!taskParameters.config.sources) {
               return;
            }
         }

         if (fileName === 'optionalBundles.json') {
            const resultContent = '(function() {var global = (function(){ return this || (1,eval)(\'this\') }());' +
               `if (!global.bundles) {global.bundles = {};} var result=${JSON.stringify(sortObjectByKeys(jsonToWrite[key]))};` +
               'Object.keys(result).forEach(function(currentKey) { global.bundles[currentKey] = result[currentKey]; })})();';
            await fs.outputFile(`${path.dirname(key)}/optionalBundles.min.js`, resultContent);
         }

         if (typeof jsonToWrite[key] === 'string') {
            await fs.outputFile(key, jsonToWrite[key]);
         } else {
            await fs.outputJson(key, sortObjectByKeys(jsonToWrite[key]));
         }
      }
   }, {
      concurrency: 10
   });
}

/**
 * Stores information about custom packages into a special package map,
 * so require.js can use it to detect custom packages when requiring a
 * single module.
 * @param {TaskParameters} taskParameters - a whole parameters list for current project build.
 * @param {String} applicationRoot - absolute path to current project's root.
 * @param {String} currentModule - current interface module name
 * @param {String} currentBundlesRoute - bundlesRoute meta of current interface module
 * @returns {Promise<void>}
 */
async function storePackageMap(taskParameters, applicationRoot, currentModule, currentBundlesRoute) {
   const normalizedBundlesRoute = {};
   Object.keys(currentBundlesRoute).forEach((module) => {
      normalizedBundlesRoute[module] = currentBundlesRoute[module].replace(/^resources\//, '');
   });
   const packageMapPath = path.join(applicationRoot, currentModule, 'packageMap.json');
   const packageMapContents = `define('${currentModule}/packageMap.json',[],function() { return ${JSON.stringify(normalizedBundlesRoute)};});`;

   await fs.outputJson(packageMapPath, normalizedBundlesRoute);
   await fs.outputFile(`${packageMapPath}.js`, packageMapContents);
   await fs.outputFile(`${packageMapPath}.min.js`, packageMapContents);
   taskParameters.addFileToCopy(currentModule, 'packageMap.json');
   taskParameters.addFileToCopy(currentModule, 'packageMap.json.js');
   taskParameters.addFileToCopy(currentModule, 'packageMap.json.min.js');
}

/**
 * Сохраняем результаты работы кастомной паковки для всех секций.
 */
async function saveModuleCustomPackResults(taskParameters, result, applicationRoot) {
   await saveBundlesForEachModule(taskParameters, applicationRoot, result);

   /**
    * write libraries meta into bundlesRoute.json.
    * Libraries should be ignored from runtime packing
    */
   await pMap(
      Object.keys(taskParameters.librariesMeta),
      async(currentModule) => {
         const currentLibraries = taskParameters.librariesMeta[currentModule];

         const currentBundlesRoutePath = path.join(applicationRoot, currentModule, 'bundlesRoute.json');
         let currentBundlesRoute = {};
         if (await fs.pathExists(currentBundlesRoutePath)) {
            currentBundlesRoute = await fs.readJson(currentBundlesRoutePath);
         }

         // Skip saving of libraries meta into bundlesRoute if there is nothing to save
         if (currentLibraries.length > 0) {
            currentLibraries.forEach((currentLibrary) => {
               // dont write libraries into bundlesRoute meta if packed into custom package
               if (!result.bundlesRoute[currentLibrary]) {
                  const normalizedLibraryPath = `${taskParameters.config.resourcesUrl ? 'resources/' : '/'}${currentLibrary}.min.js`;
                  currentBundlesRoute[currentLibrary] = normalizedLibraryPath;
               }
            });
            await fs.outputJson(currentBundlesRoutePath, sortObjectByKeys(currentBundlesRoute));
            taskParameters.addFileToCopy(currentModule, 'bundlesRoute.json');
         }
      },
      {
         concurrency: 10
      }
   );
}

/**
 * Создаёт кастомный пакет по текущей конфигурации. Записывает результаты компиляции
 * ( bundles и bundlesRoute) в общий набор - results
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {DependencyGraph} depsTree граф зависимостей
 * @param {Object} currentConfig текущая конфигурация кастомной паковки
 * @param {Object}results общие результаты компиляции для всех кастомных пакетов
 * @param {String} root корень приложения
 * @returns {Promise<void>}
 */
async function compileCurrentPackage(taskParameters, depsTree, currentConfig, results, root) {
   let currentResult = {
      bundles: {},
      optionalBundles: {},
      bundlesRoute: {},
      excludedCSS: {},
      superBundles: {}
   };


   const configNum = currentConfig.configNum ? `конфигурация №${currentConfig.configNum}` : '';
   try {
      /**
       * результатом выполнения функции мы сделаем объект, он будет содержать ряд опций:
       * 1)bundles: в нём будут храниться подвергнутые изменениям бандлы.
       * 2)bundlesRoute: тоже самое что и выше, только для bundlesRoute.
       */
      currentResult = await generateCustomPackage(
         depsTree,
         root,

         // application
         '/',
         currentConfig,
         taskParameters
      );
      logger.debug(`Создан кастомный пакет по конфигурационному файлу ${currentConfig.packageName} - ${configNum}- ${currentConfig.output}`);
      packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'excludedCSS');
   } catch (err) {
      logger.error({
         message: `Ошибка создания кастомного пакета по конфигурационному файлу ${
            currentConfig.packageName} - ${configNum}- ${currentConfig.output}`,
         error: err,
         filePath: currentConfig.path
      });
   }
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundles');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'optionalBundles');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundlesRoute');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'superBundles');
}

/**
 * Генерирует кастомные пакеты для всего набора конфигураций кастомной паковки.
 * Сперва приоритетные, для них создаётся набор записанных модулей. Затем обычные
 * пакеты, в которые уже не смогут попасть модули из приоритетных пакетов.
 * @param {Object} configs общий набор конфигураций кастомной паковки
 * @param {TaskParameters} taskParameters - whole list of parameters needed for current project
 * @param {Object} depsTree граф зависимостей
 * @param {Object} results общие результаты компиляции для всех кастомных пакетов
 * @param {String} root корень приложения
 * @returns {Promise<void>}
 */
async function generateAllCustomPackages(configs, taskParameters, depsTree, results, root) {
   const configsArray = [...Object.keys(configs.commonBundles).map(key => configs.commonBundles[key])];
   if (configs.superBundles && configs.superBundles.length > 0) {
      configsArray.splice(configsArray.length, 0, ...configs.superBundles);
   }
   const bundlesMeta = {};

   await pMap(
      taskParameters.config.modules,
      async(moduleInfo) => {
         const moduleName = transliterate(path.basename(moduleInfo.output));
         bundlesMeta[moduleName] = {
            bundlesRoute: {},
            bundles: {}
         };
         if (await fs.pathExists(path.join(root, moduleName, 'packageMap.json'))) {
            const currentBundlesRoute = await fs.readJson(path.join(root, moduleName, 'packageMap.json'));
            const result = {};
            Object.keys(currentBundlesRoute).forEach((currentModule) => {
               if (taskParameters.config.resourcesUrl) {
                  result[currentModule] = `resources/${currentBundlesRoute[currentModule]}`;
               } else {
                  result[currentModule] = currentBundlesRoute[currentModule];
               }
            });
            bundlesMeta[moduleName].bundlesRoute = result;
         }
         if (await fs.pathExists(path.join(root, moduleName, 'bundles.json'))) {
            const currentBundles = await fs.readJson(path.join(root, moduleName, 'bundles.json'));
            bundlesMeta[moduleName].bundles = currentBundles;
         }

         // add meta to common results for skipped modules
         if (moduleInfo.skipCustomPack) {
            Object.keys(bundlesMeta[moduleName].bundles).forEach((currentBundle) => {
               results.bundles[currentBundle] = bundlesMeta[moduleName].bundles[currentBundle];
            });
            Object.keys(bundlesMeta[moduleName].bundlesRoute).forEach((currentModule) => {
               const packageName = bundlesMeta[moduleName].bundlesRoute[currentModule];
               results.bundlesRoute[currentModule] = [packageName];

               if (!results.bundles[packageName] || results.bundles[packageName].length === 0) {
                  results.bundles[packageName] = [];
               }

               if (!results.bundles[packageName].includes(currentModule)) {
                  results.bundles[packageName].push(currentModule);
               }
            });
         }
      },
      {
         concurrency: 20
      }
   );

   await pMap(
      configsArray,
      async(currentConfig) => {
         await compileCurrentPackage(taskParameters, depsTree, currentConfig, results, root);
      },
      {
         concurrency: 10
      }
   );

   /**
    * sort bundlesRoute meta values in descending order to get equal results in full and patch builds
    */
   Object.keys(results.bundlesRoute).forEach((currentKey) => {
      [results.bundlesRoute[currentKey]] = helpers.descendingSort(results.bundlesRoute[currentKey]);
   });
}

/**
 * Возвращаем название Интерфейсного модуля
 * @param {String} nodeName - полное имя модуля
 * @returns {*} Название Интерфейсного модуля
 */
function getUiModuleName(nodeName) {
   const firstModulePart = nodeName.split('/')[0];
   if (firstModulePart.includes('!')) {
      return firstModulePart.split('!').pop();
   }
   return firstModulePart;
}

/**
 *
 * @param {TaskParameters} taskParameters - a whole parameters list for current project build.
 * @param {String} root - application root
 * @param {Array} intersects intersects between custom packages
 * @returns {Promise<void>}
 */
async function splitIntersectsByUiModuleName(taskParameters, root, intersects) {
   const intersectsByUiModules = {};

   intersects.forEach((currentEntry) => {
      const
         currentModule = currentEntry[0],
         currentModuleIntersect = currentEntry[1].sort(),
         interfaceModule = getUiModuleName(currentModule);

      let currentUiIntersect = intersectsByUiModules[interfaceModule];
      if (!currentUiIntersect) {
         currentUiIntersect = {};
         currentUiIntersect[currentModule] = currentModuleIntersect;
         intersectsByUiModules[interfaceModule] = currentUiIntersect;
      } else {
         currentUiIntersect[currentModule] = currentModuleIntersect;
      }
   });

   await pMap(
      Object.entries(intersectsByUiModules),
      async(currentEntry) => {
         const
            currentUiModuleName = currentEntry[0],
            currentUiModuleIntersects = currentEntry[1],
            intersectOutput = path.join(root, `${currentUiModuleName}${builderConstants.metaFolder}customPackIntersects.json`);
         logger.info(
            `В Интерфейсном модуле ${currentUiModuleName} присутствуют пересечения между кастомными пакетами!` +
            ` Посмотреть можно в json-файле по пути ${intersectOutput}`
         );
         const sortedIntersects = sortObjectByKeys(currentUiModuleIntersects);
         await fs.outputJson(intersectOutput, sortedIntersects);
      },
      {
         concurrency: 10
      }
   );
}

/**
 * Собираем в один файл все пересечения между кастомными пакетами.
 * @param {String} root - корень приложения
 * @param {Object} results - результаты создания кастомных пакетов
 * @returns {Promise<void>}
 */
async function collectAllIntersects(taskParameters, root, results) {
   const allBundlesRoute = {};

   Object.entries(results.bundles).forEach((currentEntry) => {
      const
         currentBundleName = currentEntry[0],
         currentBundle = currentEntry[1];

      currentBundle.forEach((module) => {
         if (!allBundlesRoute.hasOwnProperty(module)) {
            allBundlesRoute[module] = [currentBundleName];
         } else {
            allBundlesRoute[module].push(currentBundleName);
         }
      });
   });

   await splitIntersectsByUiModuleName(
      taskParameters,
      root,

      /**
       * оставляем только те модули, у которых больше 1 вхождения в кастомные пакеты
       */
      Object.entries(allBundlesRoute).filter(currentEntry => currentEntry[1].length > 1)
   );
}

/**
 * Получаем набор путь до бандла - конфигурация пакета
 * по пути, прописанном в супербандле
 * @param bundlePath - путь до бандла в конфигурации супербандла
 * @param configs - набор конфигураций кастомной паковки
 * @returns {*}
 */
function getCommonBundleByPath(bundlePath, configs) {
   let result = [null, null];

   // we should add "/" before bundlePath because
   // there is a possibility that a name of this interface module bundle
   // could be an end of a name of another interface module bundle
   // e.g. UI and SbisEnvUI
   const pathWithLeadingSlash = `/${bundlePath}`;
   Object.entries(configs).forEach((currentEntry) => {
      if (currentEntry[0].endsWith(pathWithLeadingSlash)) {
         result = currentEntry;
      }
   });
   return result;
}

function filterBadExcludeRules(config) {
   return config.exclude.filter((currentExcludeRule) => {
      let
         maskType = '',
         keepExcludeRule = true,
         currentExcludeNamespace;

      if (currentExcludeRule.includes('*')) {
         currentExcludeNamespace = currentExcludeRule
            .slice(0, currentExcludeRule.indexOf('*'));
         maskType = 'pattern';
      } else {
         currentExcludeNamespace = currentExcludeRule;
         maskType = 'singleton';
      }

      config.include.forEach((currentIncludeRule) => {
         if (!keepExcludeRule) {
            return;
         }
         if (
            maskType === 'pattern' &&
            currentIncludeRule.startsWith(currentExcludeNamespace) &&
            currentIncludeRule.length > currentExcludeNamespace.length
         ) {
            logger.info(`Для супербандла ${config.output} удалено правило exclude "${currentExcludeRule}".` +
               `Поскольку в include присутствует правило с большей вложенностью: ${currentIncludeRule}`);
            keepExcludeRule = false;
         }
         if (maskType === 'singleton' && currentIncludeRule === currentExcludeNamespace) {
            logger.info(`Для супербандла ${config.output} удалено правило exclude "${currentExcludeRule}".` +
               'Поскольку в include присутствует точно такое же правило');
            keepExcludeRule = false;
         }
      });

      return keepExcludeRule;
   });
}

/**
 * Задаёт modules, include и exclude для супербандла,
 * включая в него все пакеты, переданные в конфигурации супербандла.
 * Удаляет из обработки все пакеты, попавшие в супербандл.
 * @param configs - полный набор конфигураций кастомных пакетов
 */
async function setSuperBundle(taskParameters, configs, root) {
   const { commonBundles, superBundles } = configs;
   const commonBundlesToRemove = [];
   await pMap(
      superBundles,
      async(currentSuperBundle) => {
         // set default options for superbundle: "includeCore", "platformPackage"
         currentSuperBundle.includeCore = true;
         currentSuperBundle.platformPackage = true;
         if (!currentSuperBundle.include) {
            currentSuperBundle.include = [];
         }
         if (!currentSuperBundle.exclude) {
            currentSuperBundle.exclude = [];
         }
         currentSuperBundle.packagesRules = {};
         currentSuperBundle.includePackages.forEach((currentPackagePath) => {
            const [fullPackageName, neededPackage] = getCommonBundleByPath(currentPackagePath, commonBundles);
            if (neededPackage) {
               currentSuperBundle.packagesRules[currentPackagePath] = {};
               if (neededPackage.include && neededPackage.include.length > 0) {
                  currentSuperBundle.include.splice(currentSuperBundle.include.length, 0, ...neededPackage.include);
                  currentSuperBundle.packagesRules[currentPackagePath].include = neededPackage.include;
               }
               if (neededPackage.exclude && neededPackage.exclude.length > 0) {
                  currentSuperBundle.exclude.splice(currentSuperBundle.exclude.length, 0, ...neededPackage.exclude);
                  currentSuperBundle.packagesRules[currentPackagePath].exclude = neededPackage.exclude;
               }
               if (!currentSuperBundle.optional) {
                  commonBundlesToRemove.push(fullPackageName);
               }
            }
         });
         if (currentSuperBundle.includeCore && !currentSuperBundle.modules) {
            currentSuperBundle.modules = currentSuperBundle.include;
         }
         currentSuperBundle.exclude = filterBadExcludeRules(currentSuperBundle);

         const currentModuleName = removeLeadingSlashes(currentSuperBundle.path).split('/').shift();

         /**
          * remove rebuild flag from meta for superbundle config to pass diffs between full build
          * and build for patch
          */
         const currentSuperBundleMeta = { ...currentSuperBundle };
         if (currentSuperBundleMeta.hasOwnProperty('moduleInfo')) {
            delete currentSuperBundleMeta.moduleInfo;
         }

         /**
          * Сохраним конфигурацию для пакета, чтобы впоследствии мы могли посмотреть на конечную
          * конфигурацию супербандла для паковки со всеми правилами.
          */
         const relativePath = `.builder/${currentSuperBundle.output}.package.json`;
         await fs.outputJson(
            path.join(root, currentModuleName, relativePath),
            currentSuperBundleMeta
         );
         taskParameters.addFileToCopy(currentModuleName, relativePath);
      },
      {
         concurrency: 50
      }
   );

   // remove all absorbed into superbundle bundles only after all superbundles was processed
   commonBundlesToRemove.forEach(currentBundle => delete commonBundles[currentBundle]);
}

module.exports = {
   generateAllCustomPackages,
   saveModuleCustomPackResults,
   saveRootBundlesMeta,
   generateCustomPackage,
   rebaseCSS,
   collectAllIntersects,
   filterBadExcludeRules,
   setSuperBundle
};
