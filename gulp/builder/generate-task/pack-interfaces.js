/**
 * Detects all basic interfaces and theirs providers and packs them .
 * @author Kolbeshin F.A.
 */

'use strict';

const pMap = require('p-map');
const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra');
const logger = require('../../../lib/logger').logger();
const { generateContentsContent } = require('../../../lib/helpers');
const minifyJs = require('../../../lib/run-minify-js');

const P_MAP_OPTIONS = {
   concurrency: 50
};

const rmEndingNewLines = str => str.replace(/\n+$/gmi, '');

function getDefineCode(metaName, isUMD) {
   if (!isUMD) {
      return `defineModuleWithContents(${metaName}, false);`;
   }
   return `if (typeof module === 'object' && typeof module.exports === 'object') {
         defineModuleWithContents(${metaName}, true);
      } else {
         defineModuleWithContents(${metaName}, false);
      }`;
}

const generateFacadeCode = data => (`(function() {
   function defaultDefine() {
${rmEndingNewLines(data.originFacadeContent)}
   }
   function defineModuleWithContents(currentContents, isUMD) {
      var currentModuleContents = currentContents.modules[currentModuleName];
      if (currentModuleContents.features && currentModuleContents.features[currentInterface]) {
         currentProvider = currentModuleContents.features[currentInterface] + '/' + currentInterfaceParts.join('/');
         if (currentProvider === currentInterface) {
            if (isUMD) {
               return defaultDefine();
            } else {
               defaultDefine();
            }
         } else if (isUMD) {
            var ${data.callbackName} = global.requirejs(currentProvider);
            module.exports = ${data.callbackName};
         } else {
            define(currentInterface, [currentProvider], function (${data.callbackName}) {
               return ${data.callbackName};
            });
         }
      } else {
         defaultDefine();
      }
   }

  function getRootContents() {
   try {
      contents = require('json!resources/contents');
   } catch(err) {
      try {
         contents = require('json!contents')
      } catch(error) {
         contents = '';
      }
   }
}
 
   var currentProvider;
   var currentInterface = "${data.currentInterface}";
   var currentInterfaceParts = currentInterface.split('/');
   var currentModuleName = currentInterfaceParts.shift();
   var global = (function () {
      return this || (1, eval)('this');
   }());

   if (global.contents) {
      ${getDefineCode('global.contents', !!data.generateUMD)}
   } else if (typeof window === 'undefined') {
      var currentContents = getRootContents() || global.requirejs('${data.interfaceModuleName}/contents.json');
      ${getDefineCode('currentContents', !!data.generateUMD)}
   } else {
      require(['${data.interfaceModuleName}/contents.json'], function(currentContents) {
         ${getDefineCode('currentContents', false)}
      });
   }
})();`);

function updateDependencies(target, source, moduleName) {
   if (source[moduleName].facades) {
      source[moduleName].facades.forEach((currentInterface) => {
         if (target.links.hasOwnProperty(currentInterface)) {
            target.links[currentInterface] = [];
         }
      });
   }

   if (source[moduleName].providers) {
      source[moduleName].providers.forEach((currentInterface) => {
         if (target.nodes.hasOwnProperty(currentInterface)) {
            target.nodes[currentInterface].provider = true;
         }
      });
   }

   return target;
}

async function updateModuleDependencies(outputDir, actualDeps, cachedDeps) {
   await pMap(
      Object.keys(actualDeps),
      async(moduleName) => {
         const depsFilePath = path.join(outputDir, moduleName, 'module-dependencies.json');

         if (await fs.pathExists(depsFilePath)) {
            await fs.outputJson(
               depsFilePath,
               updateDependencies(await fs.readJson(depsFilePath), actualDeps, moduleName)
            );
         }

         updateDependencies(
            cachedDeps,
            actualDeps,
            moduleName
         );
      }
   );
}

async function createFacadeCode(output, currentInterface, interfaceModuleName, callbackName, extension, generateUMD) {
   const originFacadeContent = await fs.readFile(path.join(output, `${currentInterface}${extension}`), 'utf8');

   return generateFacadeCode({
      originFacadeContent,
      callbackName,
      currentInterface,
      interfaceModuleName,
      generateUMD
   });
}

// builder should update contents.json meta about features only in single-service application(apps built with
// wasaby-cli and desktop applications)
async function updateContents(taskParameters, outputDir, newModuleContents, shouldUpdateContents) {
   const { isReleaseMode, generateUMD } = taskParameters.config;
   if (!shouldUpdateContents && !global.contents) {
      global.contents = { modules: {} };
   }

   await pMap(Object.keys(newModuleContents), async(moduleName) => {
      const { moduleInfo } = newModuleContents[moduleName];
      const contentsFilePath = path.join(outputDir, moduleInfo.outputName, 'contents.json');

      if (!(await fs.pathExists(contentsFilePath))) {
         return;
      }

      const contentsJson = await fs.readJson(contentsFilePath);

      if (!contentsJson.modules[moduleInfo.outputName].features) {
         contentsJson.modules[moduleInfo.outputName].features = {};
      }
      contentsJson.modules[moduleInfo.outputName].features = newModuleContents[moduleName].features;

      // в случае сборок, где не нужно сохранять фичи в помодульный contents
      // (в таких сборках jinnee потом при деплое сервиса сам определяет фичи и
      // провайдеры и формирует contents)
      // нам нужен глобальный contents, чтобы при сборке html.tmpl файлов у нас был доступ
      // к фичам и провайдерам по аналогии с клиентской частью онлайна.
      if (!shouldUpdateContents) {
         global.contents.modules[moduleInfo.outputName] = contentsJson.modules[moduleInfo.outputName];
      } else {
         await fs.outputJson(contentsFilePath, contentsJson);
         await fs.outputFile(
            path.join(outputDir, moduleInfo.outputName, 'contents.js'),
            `contents=${JSON.stringify(contentsJson)}`
         );

         const contentsSourceCode = generateContentsContent(
            moduleInfo.outputName,
            JSON.stringify(contentsJson),
            generateUMD
         );

         await fs.outputFile(`${contentsFilePath}.js`, contentsSourceCode);

         if (!isReleaseMode) {
            return;
         }

         await fs.outputJson(contentsFilePath.replace('.json', '.min.json'), contentsJson);
         await fs.outputFile(`${contentsFilePath}.min.js`, contentsSourceCode);
         await fs.outputFile(
            path.join(outputDir, moduleInfo.outputName, 'contents.min.js'),
            `contents=${JSON.stringify(contentsJson)}`
         );
      }
   });
}

function getPreparedProviders(currentInterface, interfaces) {
   return Object.keys(interfaces.provided)
      .filter(
         currentKey => interfaces.provided[currentKey] === currentInterface
      )
      .sort((first, second) => {
         const firstIndex = interfaces.providedOrder.indexOf(first);
         const secondIndex = interfaces.providedOrder.indexOf(second);

         return firstIndex - secondIndex;
      });
}

async function processFacade(taskParameters, output, metaForUpdate) {
   const { interfaces, isReleaseMode, generateUMD } = taskParameters.config;
   const shouldUpdateContents = (
      taskParameters.config.contents && (taskParameters.config.joinedMeta || taskParameters.config.desktop)
   );
   const newModuleContents = {};

   await pMap(interfaces.required, async(interfaceName) => {
      const providers = getPreparedProviders(interfaceName, interfaces);
      const moduleInfo = taskParameters.config.getModuleInfoByName(interfaceName);
      const moduleName = interfaceName.split('/').shift();

      if (providers.length === 0) {
         logger.error({
            message: `There is no available provider of base interface ${interfaceName} in current project`,
            filePath: interfaceName,
            moduleInfo
         });
         return;
      }

      if (!metaForUpdate.hasOwnProperty(moduleName)) {
         metaForUpdate[moduleName] = {
            facades: [],
            providers: []
         };
      }

      metaForUpdate[moduleName].facades.push(interfaceName);

      providers.forEach((currentProvider) => {
         metaForUpdate[moduleName].providers.push(currentProvider);

         if (taskParameters.config.sources) {
            taskParameters.addIntoInterfaceRoute(interfaceName, `${currentProvider}.js`);
         }

         if (isReleaseMode) {
            taskParameters.addIntoInterfaceRoute(interfaceName, `${currentProvider}.min.js`);
         }
      });

      const lastProvider = interfaces.defaultProvider[interfaceName] || providers.pop();
      const [lastProviderModuleName, callbackName] = lastProvider.split('/');

      if (!newModuleContents[moduleInfo.outputName]) {
         newModuleContents[moduleInfo.outputName] = {
            moduleInfo,
            features: {}
         };
      }
      newModuleContents[moduleInfo.outputName].features[interfaceName] = lastProviderModuleName;

      if (taskParameters.config.joinedMeta) {
         const currentModuleContents = taskParameters.config.commonContents.modules[moduleInfo.outputName];
         if (!currentModuleContents.features) {
            currentModuleContents.features = {};
         }
         currentModuleContents.features[interfaceName] = lastProviderModuleName;
      }

      if (await fs.pathExists(path.join(output, `${interfaceName}.origin.js`))) {
         const debugFacadeCode = await createFacadeCode(output, interfaceName, moduleInfo.outputName, callbackName, '.origin.js', generateUMD);
         await fs.outputFile(path.join(output, `${interfaceName}.js`), debugFacadeCode);

         if (isReleaseMode) {
            const releaseFacadeCode = await createFacadeCode(output, interfaceName, moduleInfo.outputName, callbackName, '.min.origin.js', false);
            try {
               const result = await minifyJs(
                  path.join(output, `${interfaceName}.min.origin.js`),
                  releaseFacadeCode,
                  false
               );
               await fs.outputFile(path.join(output, `${interfaceName}.min.js`), result.code);
            } catch (error) {
               logger.error({
                  message: 'Error while minifying facade',
                  error,
                  moduleInfo,
                  filePath: path.join(output, `${interfaceName}.min.origin.js`)
               });
               await fs.outputFile(path.join(output, `${interfaceName}.min.js`), releaseFacadeCode);
            }
         }
      }
   }, P_MAP_OPTIONS);

   await updateContents(taskParameters, output, newModuleContents, shouldUpdateContents);
}

function generateTaskForInterfacePacking(taskParameters) {
   if (!taskParameters.config.typescript) {
      return function skipPackInterfaces(done) {
         done();
      };
   }

   return async function packInterfaces() {
      const startTime = Date.now();

      try {
         const output = taskParameters.config.outputPath;
         const metaForUpdate = {};

         await processFacade(taskParameters, output, metaForUpdate);
         await updateModuleDependencies(output, metaForUpdate, taskParameters.cache.getModuleDependencies());
      } catch (error) {
         taskParameters.cache.markCacheAsFailed();
         logger.error({
            message: 'Builder\'s error occurred during interface packing',
            error
         });
      }

      taskParameters.metrics.storeTaskTime('pack interfaces', startTime);
   };
}

module.exports = generateTaskForInterfacePacking;
module.exports.updateDependencies = updateDependencies;
