'use strict';

const commonPackage = require('../../packer/lib/common-package'),
   fs = require('fs-extra'),
   logger = require('../../lib/logger').logger(),
   packerDictionary = require('../../packer/tasks/lib/pack-dictionary'),
   packHelpers = require('./helpers/custompack'),
   path = require('path'),
   pMap = require('p-map'),
   helpers = require('../../lib/helpers'),
   cssHelpers = require('../../packer/lib/css-helpers'),
   builderConstants = require('../../lib/builder-constants'),
   transliterate = require('../../lib/transliterate'),
   { normalizeModuleName } = require('../modulepath-to-require'),
   esprima = require('esprima'),
   escodegen = require('escodegen'),
   { traverse } = require('estraverse'),
   INVALID_CHARS_FOR_VARIABLE = /\/|\?|!|-|\./g,
   SOURCE_MAPS_REGEX = /\n\/\/# sourceMappingURL=.+?\.js\.map/g;

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

async function customPackCSS(files, root, relativePackagePath) {
   let filesToPack = [];
   files.forEach((currentCss) => {
      const normalizedCss = currentCss.replace(/_ie(\.min)?.css$/, '$1.css');
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

   const resultsForIE = await pMap(
      filesToPack,
      async(css) => {
         const result = await rebaseCSS(css.replace(/(\.min)\.css$/, '_ie$1.css'), root, relativePackagePath);
         return result;
      },
      {
         concurrency: 10
      }
   );


   return {
      common: results.join('\n'),
      ie: resultsForIE.join('\n')
   };
}

// list of plugins, in case of which module names with plugins and without ones are actually different files.
// e.g. "wml!myFile" is "myFile.wml", when "myFile" is "myFile.js", but in the same time
// "optional!myFile" and "myFile" is a one physical file "myFile.js"
const commonFileTypePlugins = new Set(['wml', 'css', 'cdn', 'html', 'json', 'text', 'tmpl', 'wml']);

/**
 * checks whether or not moduleName has a common file type plugin
 * @param{String} moduleName - current module name
 * @returns {boolean}
 */
function isFileTypePlugin(moduleName) {
   const modulePlugin = moduleName.split('!').shift();
   return commonFileTypePlugins.has(modulePlugin);
}

/**
 * Creates a list of both external common and styles dependencies, because
 * styles have no callback after their loading and should be arranged at the
 * end of the list. Also create dependency->argument map to be used further
 * in lazy code generating for each internal module.
 * @param{Set} internalModules - list of internal modules of current package
 * @param{Set} dependencies - list of all dependencies of all internal modules of current package
 * @returns {{argumentSubstitutions: Map<any, any>, common: [], styles: []}}
 */
function getExternalDependencies(internalModules, dependencies) {
   /**
    * all external css styles should be loaded by require
    * in the end of the dependencies list because there is no
    * need to transmit any callback variable for it.
    */
   const externalDependencies = {
      all: [],
      common: [],
      styles: [],
      argumentSubstitutions: new Map()
   };
   dependencies.forEach((currentDependency) => {
      let normalizedDependencyName = isFileTypePlugin(currentDependency) ? currentDependency : currentDependency.split(/\?|!/).pop();

      // there can be some strange dependencies with nothing but plugins
      // e.g. i18n!controller?
      if (!normalizedDependencyName) {
         normalizedDependencyName = currentDependency;
      }
      const isExternalDependency = !internalModules.has(normalizedDependencyName);
      if (isExternalDependency) {
         if (currentDependency.startsWith('css!')) {
            externalDependencies.styles.push(currentDependency);

         // each module has its own exports, so it's pointless
         // to require "exports" as common external dependency
         } else if (!(normalizedDependencyName === 'exports')) {
            externalDependencies.common.push(currentDependency);
            externalDependencies.argumentSubstitutions.set(
               currentDependency,
               currentDependency.replace(INVALID_CHARS_FOR_VARIABLE, '_')
            );
         }
         externalDependencies.all.push(currentDependency);
      }

      /**
       * substitution should be set in any case(even for the same modules
       * but different plugins), because it will be useful further in closure code generation
       * e.g. for "optional!Env/Env" dependency we should transmit
       * Env_Env as a closure variable(in current example "Env/Env"
       * is an internal module, if it's external, we should transmit
       * "optional_Env_Env" as usual closure argument name)
       */
      let substitutionName;
      if (currentDependency.startsWith('css!')) {
         substitutionName = 'null';
      } else if (isExternalDependency) {
         substitutionName = currentDependency.replace(INVALID_CHARS_FOR_VARIABLE, '_');
      } else {
         substitutionName = normalizedDependencyName.replace(INVALID_CHARS_FOR_VARIABLE, '_');
      }
      externalDependencies.argumentSubstitutions.set(currentDependency, substitutionName);
   });
   return externalDependencies;
}

/**
 * Converts modules of current custom package to
 * lazy initialize scheme.
 * @param{Array} modulesContent - array of each internal module content
 * @param{String} bundleName - name of current package
 * @returns {[]}
 */
function convertModulesToBeLazy(modulesContent, bundleName) {
   // a whole list of dependencies of all current package members
   const packageDependenciesList = new Set();
   const internalModules = new Map();
   const resultCode = [];
   const defineBlock = [];
   const parsedModules = [];

   // first stage - parse all members of current package and get all usefull meta
   // from it(moduleName, dependencies list and factory)
   modulesContent.forEach((currentModuleContent) => {
      const currentModuleAst = esprima.parse(currentModuleContent);
      const currentModule = {
         dependencies: [],
         cssDependencies: []
      };
      traverse(currentModuleAst, {
         enter(node) {
            // узел непосредственно дефайна модуля
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
               node.arguments.forEach((argument, index) => {
                  switch (argument.type) {
                     case 'ArrayExpression':
                        argument.elements.forEach((currentElement) => {
                           if (currentElement.value.startsWith('css!')) {
                              currentModule.cssDependencies.push(currentElement.value);
                           }
                           currentModule.dependencies.push(currentElement.value);
                           packageDependenciesList.add(currentElement.value);
                        });
                        break;
                     case 'Literal':
                        // ensure it's real interface module name, not Literal formatted callback
                        if (index === 0) {
                           internalModules.set(argument.value, argument.value.replace(INVALID_CHARS_FOR_VARIABLE, '_'));
                           currentModule.moduleName = argument.value;
                        }
                        break;
                     case 'FunctionExpression':
                        currentModule.factory = escodegen.generate(argument, {
                           format: {
                              compact: true
                           }
                        });
                        currentModule.numberOfArguments = argument.params.length;
                        break;
                     default:
                        break;
                  }
               });

               this.break();
            }
         }
      });
      if (currentModule.moduleName.startsWith('css!')) {
         defineBlock.push(currentModuleContent);
      } else {
         parsedModules.push(currentModule);
      }
   });

   const externalDependencies = getExternalDependencies(internalModules, packageDependenciesList);
   resultCode.push('(function () {var bundleExports = {};');

   /**
    * require.js requires synchronous define of each current custom package module on 1 level
    * of the package, so we can't use just require to download all external dependencies for
    * closure of the package, therefore we need to use it with define of current package name,
    * and require this package further in all custom package members to make sure that all
    * external dependencies and all internal dependencies of custom package are defined
    * and initialized properly, e.g.
    * var bundleExports = {};
    * define('current/package', [<external_dependencies>], function() {lazy modules initialization>});
    * define('module1', ['current/package'], function() {return bundleExports['module1']};
    */
   resultCode.push(`define('${bundleName}',['${externalDependencies.common.join("','")}'],function(${externalDependencies.common.map(element => externalDependencies.argumentSubstitutions.get(element)).join(',')}) {`);

   // second stage - generate lazy initialize code for each single module of current package and after that
   // define all of them without requirejs dependencies by transmitting corresponding variable from closure into it's
   // factory
   parsedModules.forEach((currentParsedModule) => {
      const currentVariableName = internalModules.get(currentParsedModule.moduleName);
      const resultModuleCode = [];

      // internal module variable initialization
      resultModuleCode.push(`var ${currentVariableName};`);

      // argument list for closure and execution of current module factory
      const argumentsList = currentParsedModule.dependencies
         .map((currentModule) => {
            if (internalModules.has(currentModule)) {
               return `bundleExports['${currentModule}']`;
            }

            /**
             * for ts compiled files there is an exports syntax, so there
             * is a different way of exporting a result of current module
             * factory execution, than a result of classic factory.
             * Therefore, If module has an exports    syntax(typescript),
             * transmit its own variable as a result of factory execution then.
             */
            if (currentModule === 'exports') {
               return currentVariableName;
            }
            return externalDependencies.argumentSubstitutions.get(currentModule) ||
               'null';
         });

      // generate general code for lazy module initialize
      resultModuleCode.push(
         `Object.defineProperty(bundleExports, '${currentParsedModule.moduleName}', {` +
            'get: function() {' +
               `if (!${currentVariableName}) {` +
                  `${currentVariableName} = {};` +
                  `var result = ${currentParsedModule.factory}(${argumentsList});` +
                  `if (result) {${currentVariableName} = result;}` +
               '}' +
               `return ${currentVariableName};` +
            '},' +
            'enumerable: true' +
         '});'
      );
      resultCode.push(resultModuleCode.join('\n'));

      // Don't forget about define of a current module
      // to be further available via require.js
      // Also packed in a same package css dependencies should be required in
      // the define so they could be required properly.
      defineBlock.push(
         `define('${currentParsedModule.moduleName}',${currentParsedModule.cssDependencies.length > 0 ? `['${currentParsedModule.cssDependencies.join("','")}','${bundleName}'], ` : `['${bundleName}'],`} function() {` +
            `return bundleExports['${currentParsedModule.moduleName}'];` +
         '});'
      );
   });

   resultCode.push('});\n');
   resultCode.push(...defineBlock);
   resultCode.push('})();');
   return {
      externalDependencies: externalDependencies.all,
      internalModules,
      resultCode
   };
}

async function writeCustomPackage(
   packageConfig,
   root,
   application,
   taskParameters
) {
   const
      currentFileExists = await fs.pathExists(packageConfig.outputFile),
      originalFileExists = await fs.pathExists(packHelpers.originalPath(packageConfig.outputFile));

   // Не будем портить оригинальный файл.
   if (currentFileExists && !originalFileExists) {
      await fs.copy(packageConfig.outputFile, packHelpers.originalPath(packageConfig.outputFile));
   }

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
   const listOfModules = helpers.descendingSort(Object.keys(modulesContent));
   let result = [];
   if (listOfModules.length > 0) {
      listOfModules.forEach((currentModule) => {
         result.push(modulesContent[currentModule]);
      });
   }
   if (packageConfig.cssModulesFromOrderQueue.length > 0) {
      let cssPackagePath;

      /**
       * result of extendable bundle will be joined into root superbundle.
       * We need to set superbundle root as application root
       * for dependency of css joined superbundle
       */
      if (packageConfig.extendsTo) {
         cssPackagePath = packageConfig.extendsTo.replace(/\.js$/, '');
      } else {
         cssPackagePath = packageConfig.packagePath;
      }
      result.unshift(
         packHelpers.generateLinkForCss(
            taskParameters.themedModulesMap,
            packageConfig.cssModulesFromOrderQueue,
            cssPackagePath
         )
      );
   } else if (listOfModules.length === 0) {
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
         taskParameters.cdnModules[packageConfig.moduleName],
         `${packageConfig.packagePath}.js`
      );
      helpers.removeFileFromBuilderMeta(
         taskParameters.versionedModules[packageConfig.moduleName],
         `${packageConfig.packagePath}.js`
      );
      return;
   }

   if (packageConfig.optimized) {
      const lazyResult = convertModulesToBeLazy(result, packageConfig.packagePath);
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
   taskParameters.addFileForRemoval(packageConfig.outputFile, true);
}

function checkConfigForIncludeOption(config) {
   return config.includeCore || (config.include && config.include.length > 0);
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
      pathToCustomCSS = outputFile.replace(/(\.package)?(\.min)?\.js$/, ''),
      cssExtIncludesPackage = outputFile.replace(/(\.min)?\.js$/, '').endsWith('.package'),
      rootForCache = taskParameters.config.cachePath && !taskParameters.config.localStand ? `${taskParameters.config.cachePath}/incremental_build` : applicationRoot,
      { resourcesUrl } = taskParameters.config,
      result = {
         bundles: {},
         bundlesRoute: {},
         extendBundles: {},
         excludedCSS: {},
         superBundles: {}
      },
      excludedCSS = {};

   let
      cssModulesFromOrderQueue = [],
      bundlePath = helpers.removeLeadingSlashes(packagePath),
      orderQueue;

   /**
    * for extendable bundles meta we need to store real paths
    * of generated packages.
    */
   if (resourcesUrl && !packageConfig.extendsTo) {
      bundlePath = `resources/${bundlePath}`;
   }
   if (!checkConfigForIncludeOption(packageConfig)) {
      throw new Error('Конфиг для кастомного пакета должен содержать опцию include для нового вида паковки.');
   }

   orderQueue = packHelpers.getOrderQueue(
      depsTree,
      packageConfig,
      excludedCSS,
      rootForCache
   ).filter((node) => {
      if (node.plugin === 'js' || node.plugin === 'tmpl' || node.plugin === 'html') {
         return node.amd;
      }
      if (node.fullName.includes('css!')) {
         cssModulesFromOrderQueue.push(node);
         return false;
      }
      return true;
   });

   /**
    * создадим мета-данные для модуля, если этого не было сделано в рамках
    * Инкрементальной сборки. Нужно включать все безусловно, в пакетах могут
    * быть запакованы шаблоны с версионированием.
    */
   const moduleName = packagePath.split('/')[0];
   if (!taskParameters.versionedModules[moduleName]) {
      taskParameters.versionedModules[moduleName] = [];
   }
   if (!taskParameters.cdnModules[moduleName]) {
      taskParameters.cdnModules[moduleName] = [];
   }
   taskParameters.versionedModules[moduleName].push(`${packagePath}.js`);
   taskParameters.cdnModules[moduleName].push(`${packagePath}.js`);
   packageConfig.moduleName = moduleName;
   packageConfig.moduleOutput = helpers.prettifyPath(path.join(applicationRoot, moduleName));

   /**
    * пишем все стили по пути кастомного пакета в css-файл.
    */
   cssModulesFromOrderQueue = commonPackage.prepareResultQueue(
      cssModulesFromOrderQueue,
      applicationRoot,
      availableLanguage
   );
   const prettifiedRoot = helpers.prettifyPath(rootForCache);

   const cssPackagesNames = new Map();
   if (cssModulesFromOrderQueue.css.length > 0) {
      const cssExternalModuleUsageMessages = new Set();

      const cssRes = await customPackCSS(
         cssModulesFromOrderQueue.css
            .map(function onlyPath(currentCss) {
               const cssFullPath = currentCss.moduleYes ? currentCss.moduleYes.fullPath : currentCss.fullPath;
               const relativeCss = helpers.removeLeadingSlashes(
                  cssFullPath.replace(prettifiedRoot, '')
               );
               const prettyCssOutput = helpers.unixifyPath(path.join(root, relativeCss));
               const cssName = relativeCss.replace('.min.css', '');
               const currentFileModuleName = cssName.split('/').shift();
               const cssIsPackageOutput = prettyCssOutput === outputFile.replace(/\.js$/, '.css');

               if (
                  currentFileModuleName !== moduleName &&
                  packageConfig.moduleInfo &&
                  !packageConfig.moduleInfo.depends.includes(currentFileModuleName)
               ) {
                  const message = `External interface module "${currentFileModuleName}" usage in custom package(styles).` +
                     'Check for it existance in current interface module dependencies';
                  cssExternalModuleUsageMessages.add(message);
               }

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
                  taskParameters.filesToRemove.push(path.join(root, `${cssName}.min.css`));
                  const removeMessage = `Style ${cssFullPath} was removed in namespace of Interface module ${packageConfig.moduleName}.` +
                     `Packed into ${packageConfig.output}`;
                  logger.debug(removeMessage);
                  helpers.removeFileFromBuilderMeta(
                     taskParameters.versionedModules[moduleName],
                     cssFullPath
                  );
                  helpers.removeFileFromBuilderMeta(
                     taskParameters.cdnModules[moduleName],
                     cssFullPath
                  );
               }
               return cssFullPath;
            }),
         taskParameters.config.cachePath && !taskParameters.config.localStand ? `${taskParameters.config.cachePath}/incremental_build` : root,

         /**
          * for extendable bundles custom css packages further will be joined and saved
          * in the application root. Therefore we need to transmit application root instead of
          * custom package root in this case.
          */
         packageConfig.extendsTo ? 'fakePackageName.css' : packagePath
      );
      const cssOutputFile = `${pathToCustomCSS}${cssExtIncludesPackage ? '.package' : ''}.min.css`;
      const cssOutputFileForIE = `${pathToCustomCSS}${cssExtIncludesPackage ? '.package' : ''}_ie.min.css`;
      await fs.outputFile(cssOutputFile, cssRes.common);
      await fs.outputFile(cssOutputFileForIE, cssRes.ie);
      taskParameters.addFileForRemoval(cssOutputFile, true);
      taskParameters.addFileForRemoval(cssOutputFileForIE, true);

      /**
       * get all saved extendable css packages(common and themed)
       * to save it into apropriated root custom css package
       */
      if (packageConfig.extendsTo) {
         const extendCssPath = pathToCustomCSS.replace(helpers.prettifyPath(root), '');
         const extendsToNormalized = packageConfig.extendsTo.replace(/(\.package)?(\.js)$/, '');
         cssPackagesNames.set(
            helpers.removeLeadingSlashes(
               `${extendCssPath}.package.min.css`
            ),
            helpers.removeLeadingSlashes(
               `${extendsToNormalized}.package.min.css`
            )
         );
      }

      /**
       * создадим мета-данные для модуля, если этого не было сделано в рамках
       * Инкрементальной сборки
       */
      if (!taskParameters.versionedModules[moduleName]) {
         taskParameters.versionedModules[moduleName] = [];
      }
      if (!taskParameters.cdnModules[moduleName]) {
         taskParameters.cdnModules[moduleName] = [];
      }

      taskParameters.versionedModules[moduleName].push(`${packagePath}.css`);
      taskParameters.versionedModules[moduleName].push(`${packagePath.replace(/(\.min)?$/, '_ie$1')}.css`);
      taskParameters.cdnModules[moduleName].push(`${packagePath}.css`);
      taskParameters.cdnModules[moduleName].push(`${packagePath.replace(/(\.min)?$/, '_ie$1')}.css`);

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
   orderQueue = packerDictionary.deleteModulesLocalization(orderQueue);
   if (packageConfig.platformPackage || !packageConfig.includeCore) {
      const bundleList = (await packHelpers.generateBundle(
         orderQueue,
         cssModulesFromOrderQueue.css
      )).sort();
      if (packageConfig.extendsTo) {
         const normalizedExtendOutput = helpers.removeLeadingSlashes(
            packageConfig.extendsTo
         ).replace(/\.js$/, '.min');
         result.extendBundles[`${bundlePath}.js`] = {
            extendsTo: `${normalizedExtendOutput}.js`,
            modules: bundleList,
            config: `${packageConfig.path}:${packageConfig.output}`
         };
         cssPackagesNames.forEach((value, key) => {
            result.extendBundles[key] = {
               extendsTo: `${value}`,
               config: `${packageConfig.path}:${packageConfig.output}`
            };
         });
      } else {
         const cssBundlePath = pathToCustomCSS.replace(helpers.unixifyPath(applicationRoot), '');
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

         /**
          * if module was packed into package, we must remove excluded css with the same name as module
          * from excluded css meta
          */
         Object.keys(excludedCSS).forEach((currentKey) => {
            const nodeName = currentKey.split(/!|\?/).pop();
            if (!result.bundles[bundlePath].includes(nodeName)) {
               delete excludedCSS[currentKey];
            }
         });
      }
   }

   packageConfig.orderQueue = orderQueue;
   packageConfig.outputFile = outputFile;
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
      `bundles=${JSON.stringify(result.bundles)}`
   );
   taskParameters.addFileForRemoval(path.join(root, 'bundles.min.js'), true);
   await fs.writeJson(
      path.join(root, 'bundles.json'),
      result.bundles
   );
   taskParameters.addFileForRemoval(path.join(root, 'bundles.json'));
   await fs.writeJson(
      path.join(root, 'bundlesRoute.json'),
      result.bundlesRoute
   );
   taskParameters.addFileForRemoval(path.join(root, 'bundlesRoute.json'));
}

/**
 * Функция, которая сплитит результат работы таски custompack в секции bundles
 */
async function saveBundlesForEachModule(taskParameters, applicationRoot, result, modulesForPatch) {
   const jsonToWrite = {};

   /**
    * dont save bundlesRoute if sources flag disabled. There is no need in usage
    * of this meta in desktop applications.
    */
   const superBundles = Object.keys(result.superBundles);
   await pMap(
      Object.keys(result.bundlesRoute),
      async(currentModule) => {
         const
            moduleNameWithoutPlugins = normalizeModuleName(currentModule.split(/!|\?/).pop());

         let intModuleName;
         if (superBundles.includes(result.bundlesRoute[currentModule])) {
            [, , intModuleName] = result.bundlesRoute[currentModule].match(/(^resources\/)?([^/]+)/);
         } else if (moduleNameWithoutPlugins.includes('/')) {
            intModuleName = moduleNameWithoutPlugins.split('/').shift();
         } else {
            // single-named modules is requirejs plugins, in this case write results to WS.Core
            intModuleName = 'WS.Core';
         }

         /**
          * save bundlesRoute into moduled bundlesRoute in this cases:
          * 1)full static build - save without exclusions.
          * 2)patch static build - save results only for patching modules
          */
         if (modulesForPatch.length === 0 || modulesForPatch.includes(intModuleName)) {
            const
               bundlesRoutePath = path.normalize(path.join(applicationRoot, intModuleName, 'bundlesRoute.json'));

            if ((await fs.pathExists(bundlesRoutePath))) {
               jsonToWrite[bundlesRoutePath] = await fs.readJson(bundlesRoutePath);
            }

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
         }
      },
      {
         concurrency: 10
      }
   );

   /**
    * write bundles meta by interface modules names.
    */
   await pMap(
      Object.keys(result.bundles),
      async(currentBundle) => {
         const intModuleName = currentBundle.match(/(^resources\/)?([^/]+)/)[2];
         const bundlesPath = path.normalize(path.join(applicationRoot, intModuleName, 'bundles.json'));

         if (await fs.pathExists(bundlesPath)) {
            jsonToWrite[bundlesPath] = await fs.readJson(bundlesPath);
         }

         if (!jsonToWrite[bundlesPath]) {
            jsonToWrite[bundlesPath] = {};
         }

         // add bundles for certain modules in desktop applications
         if (['Superbundles', 'RetailOffline', 'SBISPluginBase'].includes(intModuleName)) {
            jsonToWrite[bundlesPath][currentBundle] = result.bundles[currentBundle];
         }
      },
      {
         concurrency: 10
      }
   );

   // write extendable bundles meta by interface modules names.
   await pMap(
      Object.keys(result.extendBundles),
      async(currentExtendBundle) => {
         const intModuleName = currentExtendBundle.match(/(^resources\/)?([^/]+)/)[2];
         const bundlesPath = path.normalize(path.join(applicationRoot, intModuleName, 'extend-bundles.json'));
         if (await fs.pathExists(bundlesPath)) {
            jsonToWrite[bundlesPath] = await fs.readJson(bundlesPath);
         }
         if (!jsonToWrite[bundlesPath]) {
            jsonToWrite[bundlesPath] = {};
         }
         jsonToWrite[bundlesPath][currentExtendBundle] = result.extendBundles[currentExtendBundle];
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
            await updateContents(taskParameters, applicationRoot, moduleName);

            // dont save bundlesRoute in desktop application, it's only needed to save packageMap.
            if (!taskParameters.config.sources) {
               return;
            }
         }
         await fs.outputJson(key, sortObjectByKeys(jsonToWrite[key]));
         taskParameters.addFileForRemoval(key);
      }
   }, {
      concurrency: 10
   });
}

/**
 * Stores information about custom packages into a special package map,
 * so require.js can use it to detect custom packages when requiring a
 * single module.
 * @param{TaskParameters} taskParameters - a whole parameters list for current project build.
 * @param{String} applicationRoot - absolute path to current project's root.
 * @param{String} currentModule - current interface module name
 * @param{String} currentBundlesRoute - bundlesRoute meta of current interface module
 * @returns {Promise<void>}
 */
async function storePackageMap(taskParameters, applicationRoot, currentModule, currentBundlesRoute) {
   const packageMapPath = path.join(applicationRoot, currentModule, 'packageMap.json');
   const packageMapContents = `define('${currentModule}/packageMap.json',[],function() { return ${JSON.stringify(currentBundlesRoute)};});`;

   await fs.outputFile(`${packageMapPath}.js`, packageMapContents);
   taskParameters.addFileForRemoval(`${packageMapPath}.js`);
   await fs.outputFile(`${packageMapPath}.min.js`, packageMapContents);
   taskParameters.addFileForRemoval(`${packageMapPath}.min.js`);
}

/**
 * Updates and stores in contents meta information about existence of custom packages
 * in current interface module
 * @param{TaskParameters} taskParameters - a whole parameters list for current project build.
 * @param{String} applicationRoot - absolute path to current project's root.
 * @param{String} currentModule - current interface module name
 * @returns {Promise<void>}
 */
async function updateContents(taskParameters, applicationRoot, currentModule) {
   const contentsPath = path.join(applicationRoot, currentModule, 'contents.json');

   if (taskParameters.config.joinedMeta && taskParameters.config.contents) {
      // store meta about bundles in contents, so require.js can know there are packages in this interface module
      taskParameters.config.commonContents.modules[currentModule].hasBundles = true;
   }

   if (await fs.pathExists(contentsPath)) {
      const currentContents = await fs.readJson(contentsPath);
      currentContents.modules[currentModule].hasBundles = true;
      const amdContents = `define('${currentModule}/contents.json',[],function(){return ${JSON.stringify(currentContents)};});`;
      await fs.outputJson(contentsPath, currentContents);
      await fs.outputFile(`${contentsPath}.js`, amdContents);
      await fs.outputFile(`${contentsPath}.min.js`, amdContents);
   }
}

/**
 * Сохраняем результаты работы кастомной паковки для всех секций.
 */
async function saveModuleCustomPackResults(taskParameters, result, applicationRoot, modulesForPatch) {
   await saveBundlesForEachModule(taskParameters, applicationRoot, result, modulesForPatch);

   // save separated by modules meta files "versioned_modules.json"
   if (taskParameters.config.version) {
      await pMap(
         Object.keys(taskParameters.versionedModules),
         async(currentModule) => {
            /**
             * When we build UI-patch, meta files must be saved only for patching modules.
             * Otherwise save all meta we have.
             */
            if (modulesForPatch.length === 0 || modulesForPatch.includes(currentModule)) {
               const outputVersionedMeta = path.join(applicationRoot, currentModule, '.builder/versioned_modules.json');

               // write versioned-modules meta in a way corresponding to origin generation of it
               // (in create-versioned-modules gulp plugin)
               await fs.outputFile(
                  outputVersionedMeta,
                  Buffer.from(JSON.stringify(taskParameters.versionedModules[currentModule].sort()))
               );
               taskParameters.addFileForRemoval(outputVersionedMeta);
            }
         },
         {
            concurrency: 10
         }
      );
   }

   // save separated by modules meta file cdn_modules.json into output
   await pMap(
      Object.keys(taskParameters.cdnModules),
      async(currentModule) => {
         /**
          * When we build UI-patch, meta files must be saved only for patching modules.
          * Otherwise save all meta we have.
          */
         if (modulesForPatch.length === 0 || modulesForPatch.includes(currentModule)) {
            const outputCdnMeta = path.join(applicationRoot, currentModule, '.builder/cdn_modules.json');

            // write cdn meta in a way corresponding to origin generation of it
            // (in create-cdn-modules gulp plugin)
            await fs.outputFile(
               outputCdnMeta,
               Buffer.from(JSON.stringify(taskParameters.cdnModules[currentModule].sort()))
            );
            taskParameters.addFileForRemoval(outputCdnMeta);
         }
      },
      {
         concurrency: 10
      }
   );

   /**
    * write libraries meta into bundlesRoute.json.
    * Libraries should be ignored from runtime packing
    */
   await pMap(
      Object.keys(taskParameters.librariesMeta),
      async(currentModule) => {
         const currentLibraries = taskParameters.librariesMeta[currentModule];

         // skip packageMap and libraries savings for all interface modules
         // that aren't participating in patch build.
         if (modulesForPatch.length === 0 || modulesForPatch.includes(currentModule)) {
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
               await fs.outputJson(currentBundlesRoutePath, currentBundlesRoute);
               taskParameters.addFileForRemoval(currentBundlesRoutePath);
            }
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
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {DependencyGraph} depsTree граф зависимостей
 * @param {Object} currentConfig текущая конфигурация кастомной паковки
 * @param {Object}results общие результаты компиляции для всех кастомных пакетов
 * @param {String} root корень приложения
 * @returns {Promise<void>}
 */
async function compileCurrentPackage(taskParameters, depsTree, currentConfig, results, root) {
   let currentResult = {
      bundles: {},
      bundlesRoute: {},
      excludedCSS: {},
      extendBundles: {},
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
      packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'excludedCSS');
      logger.debug(`Создан кастомный пакет по конфигурационному файлу ${currentConfig.packageName} - ${configNum}- ${currentConfig.output}`);
   } catch (err) {
      logger.error({
         message: `Ошибка создания кастомного пакета по конфигурационному файлу ${
            currentConfig.packageName} - ${configNum}- ${currentConfig.output}`,
         error: err,
         filePath: currentConfig.path
      });
   }
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundles');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundlesRoute');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'extendBundles');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'superBundles');
}

/**
 * Генерирует кастомные пакеты для всего набора конфигураций кастомной паковки.
 * Сперва приоритетные, для них создаётся набор записанных модулей. Затем обычные
 * пакеты, в которые уже не смогут попасть модули из приоритетных пакетов.
 * @param {Object} configs общий набор конфигураций кастомной паковки
 * @param {TaskParameters} taskParameters параметры для задач
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
   const modulesForPatch = [];
   await pMap(
      taskParameters.config.modules,
      (moduleInfo) => {
         const moduleName = transliterate(path.basename(moduleInfo.output));
         if (moduleInfo.rebuild) {
            modulesForPatch.push(moduleName);
         }
      },
      {
         concurrency: 20
      }
   );

   /**
    * store "modules for patch" info into results. Needed by packages intercepts
    * collector - dont analize intercepts in non-patching modules.
    */
   results.modulesForPatch = modulesForPatch;
   await pMap(
      configsArray,
      async(currentConfig) => {
         const moduleName = helpers.removeLeadingSlashes(currentConfig.path).split('/').shift();

         /**
          * in patch build skip package configs from non-patching interface modules.
          * They needs only to get proper info for superbundles in patching modules.
          */
         if (modulesForPatch.length > 0 && !modulesForPatch.includes(moduleName)) {
            return;
         }
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
 * Разбиваем пересечения по Интерфейсным модулям
 * @param {Array} modulesForPatch модули для сборки патча
 * @param {String} root корень приложения
 * @param {Array[][]} intersects пересечения между кастомными пакетами
 * @returns {Promise<void>}
 */
async function splitIntersectsByUiModuleName(modulesForPatch, root, intersects) {
   const intersectsByUiModules = {};

   intersects.forEach((currentEntry) => {
      const
         currentModule = currentEntry[0],
         currentModuleIntersect = currentEntry[1].sort(),
         interfaceModule = getUiModuleName(currentModule);

      // ignore intersects for non-patching modules
      if (modulesForPatch.length > 0 && !modulesForPatch.includes(interfaceModule)) {
         return;
      }
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
         await fs.outputJson(intersectOutput, sortObjectByKeys(currentUiModuleIntersects));
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
async function collectAllIntersects(root, results) {
   const
      { bundles, modulesForPatch } = results,
      allBundlesRoute = {};

   Object.entries(bundles).forEach((currentEntry) => {
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
      modulesForPatch,
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
async function setSuperBundle(configs, root, modulesForPatch) {
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
               commonBundlesToRemove.push(fullPackageName);
            }
         });
         if (currentSuperBundle.includeCore && !currentSuperBundle.modules) {
            currentSuperBundle.modules = currentSuperBundle.include;
         }
         currentSuperBundle.exclude = filterBadExcludeRules(currentSuperBundle);

         const currentModuleName = helpers.removeLeadingSlashes(currentSuperBundle.path).split('/').shift();
         if (modulesForPatch.length > 0 && !modulesForPatch.includes(currentModuleName)) {
            return;
         }

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
         await fs.outputJson(
            path.join(root, currentModuleName, `.builder/${currentSuperBundle.output}.package.json`),
            currentSuperBundleMeta
         );
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
