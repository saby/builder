/**
 * Набор функций, необходимых для работы паковщика библиотек:
 * builder/lib/pack/library-packer.js
 * @author Kolbeshin F.A.
 */

'use strict';

const { Syntax } = require('espree');
const { parseCode } = require('../../espree/common');
const { path } = require('../../../lib/platform/path');
const fs = require('fs-extra');
const logger = require('../../logger').logger();
const SOURCE_EXTENSIONS_MAP = {
   'ts': 'js',
   'tsx': 'js',
   'wml': 'wml',
   'tmpl': 'tmpl',
   'html': 'xhtml'
};

const {
   getLibraryMeta,
   collectDependencies,
   addExternalDepsToLibrary,
   isPrivate
} = require('../../espree/library');
const { descendingSort } = require('../../helpers');
const { formatError } = require('../../format-error');

/**
 * удаляем из зависимостей библиотеки и из аргументов функции callback'а
 * приватные части библиотеки, поскольку они обьявлены внутри callback'а.
 * @param {Number} privateDependencyIndex - расположение зависимости в общем списке
 * @param {Object} libraryDependencies - мета-данные всех зависимостей библиотеки и зависимостей
 * всех её приватных частей.
 * @param {Array} libraryParametersNames - массив аргументов функции callback'а библиотеки
 */
function deletePrivateDepsFromList(privateDependencyIndex, libraryDependencies, libraryParametersNames) {
   libraryDependencies.splice(privateDependencyIndex, 1);

   if (privateDependencyIndex <= libraryParametersNames.length) {
      libraryParametersNames.splice(
         privateDependencyIndex,
         1
      );
   }
}

/**
 * Возвращает кэш из taskParameters.cache для конкретной анализируемой зависимости
 * @param privateModulesCache - кэш из taskParameters.cache для приватных модулей
 * @param moduleName - имя анализируемой зависимости
 * @returns {String}
 */
function getCacheByModuleName(privateModulesCache, moduleName) {
   const result = {};

   Object.keys(privateModulesCache).forEach((cacheName) => {
      const currentCache = privateModulesCache[cacheName];

      if (currentCache.nodeName === moduleName) {
         result.text = currentCache.text;
         result.versioned = currentCache.versioned;
         result.cdnLinked = currentCache.cdnLinked;
         result.error = currentCache.error;
      }
   });

   return result;
}

/**
 * Убираем плагины require, чтобы в случае недоступности файла по данному плагину
 * в кэше мы могли прочитать исходный модуль из файловой системы
 */
function normalizeDependencyName(dependency) {
   if (dependency.startsWith('browser!')) {
      return dependency.replace('browser!', '');
   }

   return dependency;
}

async function getExtensionByPlugin(sourceRoot, pluginName, dependencyWithoutPlugins) {
   if (!pluginName) {
      const sourcePathWithoutExtension = path.join(sourceRoot, dependencyWithoutPlugins);

      if (await fs.pathExists(`${sourcePathWithoutExtension}.tsx`)) {
         return 'tsx';
      }
      if (await fs.pathExists(`${sourcePathWithoutExtension}.ts`)) {
         return 'ts';
      }

      return 'js';
   }

   if (pluginName === 'html') {
      return 'xhtml';
   }

   return pluginName;
}

/**
 *
 * @param {String} sourceRoot - путь до UI-исходников
 * @param {String} outputRoot
 * @param {String} libraryName - имя анализируемой библиотеки
 * @param {String} currentDependency - текущая зависимость библиотеки
 * @param {Array} libraryDependenciesMeta - мета-данные зависимостей либы
 * @param {Array} externalDependenciesToPush - набор внешних зависимостей
 * @param privateModulesCache
 * приватных частей библиотеки, которые нам надо будет добавить в массив
 * зависимостей библиотеки
 * @returns {Promise<void>} - мета-данные приватной зависимости:
 * 1)ast - callback приватной зависимости в ast-формате
 * 2)dependencies - набор зависимостей приватного модуля
 * 3)moduleName - имя приватного модуля
 */
async function readModuleAndGetParamsNames(
   options,
   sourceRoot,
   outputRoot,
   libraryName,
   currentDependency,
   libraryDependenciesMeta,
   externalDependenciesToPush,
   privateModulesCache
) {
   const { tsxProdCachePath, generateUMD } = options;
   const normalizedCurrentDependency = normalizeDependencyName(currentDependency);
   const moduleData = getCacheByModuleName(privateModulesCache, normalizedCurrentDependency);

   // cache for module could be only this module was changed since last build, it is rebuilt by builder
   // and stored in cache. In all other cases we can get module content only by reading it from output
   // directory
   const result = {};
   if (moduleData.error) {
      throw new Error(`Module ${currentDependency} was compiled with errors. Check current build logs to see errors.`);
   }

   if (!moduleData.text) {
      /**
       * If wml private module haven't gotten from builder cache(cache is needed to support
       * incremental build scheme), there is no 'wml' flag set as true in current build
       * configuration file. Log it with according error message.
       */
      const dependencyParts = normalizedCurrentDependency.split('!');
      const isModuleWithPlugin = dependencyParts.length > 1;
      const dependencyWithoutPlugins = dependencyParts.pop();

      const extension = await getExtensionByPlugin(
         sourceRoot,
         isModuleWithPlugin ? dependencyParts.shift() : null,
         dependencyWithoutPlugins
      );

      let modulePath = `${path.join(outputRoot, dependencyWithoutPlugins)}.min.${SOURCE_EXTENSIONS_MAP[extension] || extension}`;

      // try to load compiled code from sources first, could be a situation when compiled code
      // is located in sources(e.g. Compiler), otherwise try to load compiled code from output directory
      // for js in sources always load them from sources.
      const sourcePath = `${path.join(sourceRoot, dependencyWithoutPlugins)}.${extension}`;
      const modulePathExists = await fs.pathExists(modulePath);

      // log information about current file directory list if compiled version of current file
      // isn't found in output directory
      if (!modulePathExists && extension !== '.js') {
         const filesList = await fs.readdir(path.dirname(modulePath));
         logger.debug(`compiled file ${dependencyWithoutPlugins} is not found. Current output files list for directory "${path.dirname(modulePath)}":\n${JSON.stringify(filesList, null, 3)}`);
      }

      if ((extension === 'js' && await fs.pathExists(sourcePath)) || !modulePathExists) {
         modulePath = sourcePath;
      }

      // В umd формате при пересборке библиотеки мы вынуждены читать приватные модули
      // в .min.js файле, но при упаковке в библиотеку и дальнейшей минификации некоторые
      // конструкции будут минифицированы немного по другому. В результате этого при сборке
      // патча, когда модуль для патча собирается с нуля, получаются диффы в библиотеках,
      // хотя при этом исходный код не подвергался изменениям. В качестве временного решения
      // для сборки в amd формате читаем дебажную версию приватного модуля.
      // P.S. Для tsx файлов в дебаге и релизе используются совершенно разные react-библиотеки и генерится
      // разный код, он не является обратно совместимым и не будет работать. Чтобы решить данную проблему
      // дебажная версия production-кода tsx файла пишется в кеш билдера, откуда нам его и надо достать при
      // запросе непересобираемого приватного модуля библиотеки.
      if (!generateUMD && modulePath.endsWith('.min.js')) {
         if (extension === 'tsx') {
            modulePath = modulePath
               .replace(outputRoot, tsxProdCachePath)
               .replace('.min.js', '.js');
         } else {
            modulePath = modulePath.replace('.min.js', '.js');
         }
      }

      try {
         moduleData.text = await fs.readFile(modulePath, 'utf8');
      } catch (err) {
         throw new Error(`Compiled data for private module "${dependencyWithoutPlugins}" isn't found. Check if this private module exists. If removed, check library and its private dependencies for having this removed dependency. ${err}`);
      }

      result.sourcePath = sourcePath;
      result.modulePath = modulePath;
   }

   let moduleAst;
   try {
      moduleAst = parseCode(moduleData.text);
   } catch (error) {
      const title = `An error occurred while parsing compiled private dependency "${result.modulePath || currentDependency}".`;

      throw Object.assign(new Error(), {
         message: formatError({
            title,
            error,
            sourceText: moduleData.text
         }),
         stack: null
      });
   }

   result.moduleName = currentDependency;
   result.versioned = moduleData.versioned;
   result.cdnLinked = moduleData.cdnLinked;
   result.dependencies = [];

   const dependenciesNames = collectDependencies(moduleAst, normalizedCurrentDependency, result);

   if (!result.ast) {
      externalDependenciesToPush.push(currentDependency);
      result.externalDependency = true;
   }

   result.dependencies.forEach((dependency) => {
      const dependencyName = dependenciesNames[result.dependencies.indexOf(dependency)];
      let needToPushToLibraryDeps = false;

      // add private modules external dependencies into library in 2 cases:
      // 1) library don't have it as dependency
      // 2) library have this dependency, but it's unused inside of library callback
      if (
         !libraryDependenciesMeta.hasOwnProperty(dependency) ||
         (
            libraryDependenciesMeta[dependency].names &&
            libraryDependenciesMeta[dependency].names.length === 0
         )
      ) {
         needToPushToLibraryDeps = true;
      }

      if (!isPrivate(dependency) && needToPushToLibraryDeps) {
         externalDependenciesToPush.push(dependency);
      }

      if (needToPushToLibraryDeps) {
         libraryDependenciesMeta[dependency] = dependencyName ? {
            names: [dependencyName]
         } : {
            names: []
         };
      } else if (dependencyName && !libraryDependenciesMeta[dependency].names.includes(dependencyName)) {
         libraryDependenciesMeta[dependency].names.push(dependencyName);
      }
   });

   return result;
}

function depsSortingFunc(a, b) {
   if (a.depth > b.depth) {
      return 1;
   }

   if (a.depth < b.depth) {
      return -1;
   }

   /**
    * add another sort by name. dependencies order
    * can be different between several builds.
    * Setting another sorting by dependency name
    * give us guarantee of the same order in all builds
    * for current interface module
    */
   if (a.moduleName > b.moduleName) {
      return 1;
   }

   if (a.moduleName < b.moduleName) {
      return -1;
   }

   return 0;
}

/**
 * Функция для сортировки модулей по зависимостям. Если модуль A из пакета зависит от модуля B
 * из пакета, то модуль B должен быть определён до модуля A. Если встречается внешняя зависимость,
 * то это никак не влияет на модуль.
 * @param {Array} privateDependencies - набор приватных зависимостей библиотеки.
 * @returns {*}
 */
function sortPrivateModulesByDependencies(privateDependencies) {
   function calcMaxDepth(moduleName, currentDepth, maxDepth) {
      const dependency = privateDependencies.find(module => module.moduleName === moduleName);

      if (!dependency) {
         return maxDepth;
      }

      let newMaxDepth = maxDepth + 1;

      if (dependency.dependencies) {
         dependency.dependencies.forEach((depModuleName) => {
            const depth = calcMaxDepth(depModuleName, currentDepth + 1, newMaxDepth);

            newMaxDepth = depth > currentDepth ? depth : currentDepth;
         });
      }

      return newMaxDepth;
   }

   for (const currentModule of privateDependencies) {
      currentModule.depth = 0;
      if (currentModule.dependencies) {
         currentModule.dependencies.forEach((dep) => {
            const maxDepth = calcMaxDepth(dep, 0, 0);

            currentModule.depth = maxDepth > currentModule.depth ? maxDepth : currentModule.depth;
         });
      }
   }

   return privateDependencies.sort(depsSortingFunc);
}

/**
 * get current 'exports' variable name by its index in
 * dependencies list and corresponding index in callback
 * params name
 * @param {Array} dependencies list of dependencies
 * @param {Object} functionCallbackAST ast tree of callback function
 * @returns {string|*|string}
 */
function getCommonVariablesNames(dependencies, functionCallbackAST) {
   const indexOfExports = dependencies.indexOf('exports');
   const indexOfTslib = dependencies.indexOf('tslib');
   let exportsName = '', tslibName = '';
   if (indexOfExports === -1) {
      exportsName = 'exports';
   }
   if (indexOfTslib === -1) {
      tslibName = 'tslib_1';
   }
   if (!exportsName) {
      exportsName = (functionCallbackAST.params[indexOfExports] && functionCallbackAST.params[indexOfExports].name) || 'exports';
   }
   if (!tslibName) {
      tslibName = (functionCallbackAST.params[indexOfTslib] && functionCallbackAST.params[indexOfTslib].name) || 'tslib_1';
   }
   return { exportsName, tslibName };
}

/**
 * Returns right operator of current assignment expression.
 * Handles case when this is a sequence of asignments, e.g.
 * exports.something = exports.anotherVariable = someValue;
 * @param {Object} expression - current expression ast tree
 * @returns {*}
 */
function getRightOperator(expression) {
   let result = expression.right;
   while (result.right) {
      result = result.right;
   }
   return result;
}

/**
 * gets value name by transmitted expression
 * @param${Object} expression ast tree of current expression
 * @returns {string}
 */
function getValueName(expression) {
   let result = '';
   if (expression.type === Syntax.AssignmentExpression) {
      const rightOperator = getRightOperator(expression);
      switch (rightOperator.type) {
         case Syntax.MemberExpression:
            result = rightOperator.object.name;
            break;
         case Syntax.Identifier:
            result = rightOperator.name;
            break;
         default:
            break;
      }
   } else if (expression.type === Syntax.CallExpression && expression.callee.object) {
      if (
         expression.callee.object.name === 'Object' &&
         expression.callee.property.name === 'defineProperty'
      ) {
         const currentExpressionValue = expression.arguments[2];
         let currentGetter = '';
         currentExpressionValue.properties.forEach((currentProperty) => {
            if (currentProperty.key && currentProperty.key.name === 'get') {
               currentGetter = currentProperty;
            }
         });
         if (currentGetter) {
            const currentGetterValue = currentGetter.value.body.body[0];
            if (currentGetterValue.type === Syntax.ReturnStatement) {
               const currentArgument = currentGetterValue.argument;
               switch (currentArgument.type) {
                  case Syntax.MemberExpression:
                     result = currentArgument.object.name;
                     break;
                  case Syntax.Literal:
                  case Syntax.Identifier:
                     result = currentArgument.name;
                     break;
                  default:
                     break;
               }
            }
         }
      } else if (
         expression.callee.object.name === 'tslib_1' &&
         expression.callee.property.name === '__exportStar'
      ) {
         result = expression.arguments[0].name;
      }
   }
   return result;
}

function processExpression(commonVariablesNames, currentBlock, currentBlockExpression, index, valueName) {
   const { exportsName, tslibName } = commonVariablesNames;
   const resultExports = [];
   let hasExports = false;
   let hasReturn = false;
   if (currentBlockExpression) {
      // there could be 2 type of exports:
      // 1) export.property = 'something';
      // 2) Object.defineProperty(exports, 'property', { value: 'something' })
      if (currentBlockExpression.type === Syntax.AssignmentExpression) {
         const leftExpression = currentBlockExpression.left;
         if (leftExpression && leftExpression.object && leftExpression.object.name === exportsName) {
            if (!valueName) {
               resultExports.push({
                  currentBlock,
                  index
               });
            } else {
               const currentBlockValueName = getValueName(currentBlockExpression);

               // if current block has an assignment of void or variable that is interface and unusable
               // we should add it for further remove from library callback
               if (currentBlockValueName === valueName) {
                  resultExports.push({
                     currentBlock,
                     index,
                     propertyName: leftExpression.property.name
                  });
               }
            }
         }
      } else if (currentBlockExpression.type === Syntax.CallExpression) {
         const currentExpression = currentBlockExpression;
         if (currentExpression.callee.object) {
            if (
               currentExpression.callee.object.name === 'Object' &&
               currentExpression.callee.property.name === 'defineProperty'
            ) {
               const [currentObject, currentProperty] = currentExpression.arguments;
               if (currentObject.name === exportsName) {
                  if (!valueName) {
                     if (currentProperty.type === Syntax.Literal) {
                        if (currentProperty.value === '__esModule') {
                           hasExports = true;
                        } else {
                           resultExports.push(currentBlock);
                        }
                     }
                  } else {
                     const currentBlockValueName = getValueName(currentBlockExpression);
                     if (currentBlockValueName === valueName) {
                        resultExports.push({
                           currentBlock,
                           index
                        });
                     }
                  }
               }

               // tslib_1.__exportStar is also an exports expression to check
            } else if (
               currentExpression.callee.object.name === tslibName &&
               currentExpression.callee.property.name === '__exportStar'
            ) {
               if (valueName) {
                  const currentBlockValueName = getValueName(currentBlockExpression);
                  if (currentBlockValueName === valueName) {
                     resultExports.push({
                        currentBlock,
                        index
                     });
                  }
               } else {
                  resultExports.push(currentBlock);
               }
            }
         }
      }
   } else if (currentBlock.type === Syntax.ReturnStatement) {
      hasReturn = true;
   }
   return { resultExports, hasExports, hasReturn };
}

/**
 * gets meta info about each found exports of void exports
 * (e.g. interfaces or exports with 'void 0' value)
 * @param {Object} bodyAst body of ast tree of current module
 * @param {String} commonVariablesNames names of common dependencies of ts compiled file(e.g. exports, tslib)
 * @param {String} valueName? name of value to search
 * @returns {{hasReturnStatement: boolean, currentModuleExports: *[]}}
 */
function getVoidExportsMeta(bodyAst, commonVariablesNames, valueName) {
   const currentModuleExports = [];
   const currentModuleSequences = {};
   let hasReturnStatement = false;
   let hasDefaultExportsDefine = false;
   const processBlock = (currentBlock, currentBlockExpression, blockIndex, subIndex) => {
      const {
         resultExports,
         hasReturn,
         hasExports
      } = processExpression(commonVariablesNames, currentBlock, currentBlockExpression, blockIndex, valueName);
      if (hasReturn) {
         hasReturnStatement = true;
      }
      if (hasExports) {
         hasDefaultExportsDefine = true;
      }

      if (subIndex && resultExports.length > 0) {
         if (!currentModuleSequences[blockIndex]) {
            currentModuleSequences[blockIndex] = [];
         }
         currentModuleSequences[blockIndex].push(subIndex);
      } else {
         currentModuleExports.push(...resultExports);
      }
   };
   bodyAst.forEach((currentBlock, index) => {
      if (currentBlock.expression && currentBlock.expression.type === Syntax.SequenceExpression) {
         currentBlock.expression.expressions.forEach((currentSequenceBlock, currentIndex) => {
            processBlock(currentBlock, currentSequenceBlock, index, currentIndex);
         });
      } else {
         processBlock(currentBlock, currentBlock.expression, index, false);
      }
   });
   return {
      currentModuleExports,
      currentModuleSequences,
      hasReturnStatement,
      hasDefaultExportsDefine
   };
}

/**
 * gets indexes of all void exports by transmitted value name
 * @param {Object} bodyAst body of ast tree of current module
 * @param {String} commonVariablesNames names of common dependencies of ts compiled file(e.g. exports, tslib)
 * @param {String} valueName name of value to search
 * @returns {*}
 */
function getExportsIndexesByValueName(bodyAst, commonVariablesNames, valueName) {
   const currentExports = getVoidExportsMeta(bodyAst, commonVariablesNames, valueName);
   return {
      singleNodes: descendingSort(currentExports.currentModuleExports.map(currentExport => currentExport.index)),
      sequenceNodes: currentExports.currentModuleSequences
   };
}

/**
 * checks if current module has any exports besides default exports of __esModule
 * @param {Object} dependencyContent common meta about current private module of library
 * (ast tree of its callback, dependencies list, etc.)
 * @returns {boolean}
 */

function hasNoExports(dependencyContent) {
   const { dependencies, ast } = dependencyContent;
   const bodyAst = ast.body.body;
   const { exportsName } = getCommonVariablesNames(dependencies, ast);
   const usableExpressions = [];

   /**
    * in empty interface modules could be only 2 expressions:
    * 1) "use strict";
    * 2) Object.defineProperty(exports, '__esModule', { value: true })
    * If anything else is found in this module, it can't be removed from result library
    */
   bodyAst.forEach((currentBlock) => {
      if (currentBlock.type === Syntax.ExpressionStatement) {
         const currentExpression = currentBlock.expression;

         // "use strict"
         if (currentExpression.type === Syntax.Literal && currentExpression.value === 'use strict') {
            return;
         }

         // if current expression is "Object.defineProperty(exports, 'someVariable', ...)", it
         // is also can be in private void modules
         if (
            currentExpression.type === Syntax.CallExpression &&
            currentExpression.callee &&
            currentExpression.callee.object &&
            currentExpression.callee.object.name === 'Object' &&
            currentExpression.callee.property.name === 'defineProperty' &&
            currentExpression.arguments[0].name === exportsName &&
            currentExpression.arguments[1].value === '__esModule'
         ) {
            return;
         }
         usableExpressions.push(currentBlock);
      } else {
         usableExpressions.push(currentBlock);
      }
   });

   return usableExpressions.length === 0;
}

module.exports = {
   getLibraryMeta,
   readModuleAndGetParamsNames,
   sortPrivateModulesByDependencies,
   addExternalDepsToLibrary,
   isPrivate,
   deletePrivateDepsFromList,
   getCommonVariablesNames,
   hasNoExports,
   getVoidExportsMeta,
   getExportsIndexesByValueName
};
