'use strict';

const { path } = require('../../lib/platform/path');
const logger = require('../logger').logger();

const escodegen = require('../third-party/escodegen');
const { Syntax } = require('espree');
const { parseCode } = require('./common');
const { traverse } = require('estraverse');

const { invalidCharsForVariable } = require('../builder-constants');
const libPackHelpers = require('../pack/helpers/librarypack');

/**
 * Список нативных имён. Нельзя обьявлять алиасы при паковке библиотеки,
 * если алиас имеет имя нативной функции/переменной, мы можем перебить использование
 * нативной функции/переменной кастомным аналогом.
 * @type {string[]}
 */
const nativeJavascriptNames = ['fetch', 'Date', 'Object', 'Array', 'Number'];
const { descendingSort } = require('../helpers');

/**
 * Removes global 'use strict' statement if exists.
 * Repairs first level return statement position if exists.
 * @param {Object} functionCallbackBody - AST tree of private module callback function
 * @param {Object} topLevelReturnStatement - return statement of current private module
 * @param {Object} exportsDefine - statement of exports property definition
 */
function removeStrictModeStatement(functionCallbackBody, topLevelReturnStatement, exportsDefine) {
   if (escodegen.generate(functionCallbackBody.body[0]).includes('\'use strict\';')) {
      functionCallbackBody.body.splice(0, 1);

      if (topLevelReturnStatement) {
         topLevelReturnStatement.position--;
      }

      if (exportsDefine) {
         exportsDefine.position--;
      }
   }
}

function removeFoundIndexes(currentExportsIndexes, rootNodesArray) {
   const { singleNodes, sequenceNodes } = currentExportsIndexes;

   // remove each found useless export from library
   singleNodes.forEach((currentIndex) => {
      rootNodesArray.splice(currentIndex, 1);
   });

   Object.keys(sequenceNodes).forEach((currentIndex) => {
      const currentSequenceIndexes = descendingSort(sequenceNodes[currentIndex]);
      const currentSequenceExpression = rootNodesArray[currentIndex].expression;
      currentSequenceIndexes.forEach((currentSequenceIndex) => {
         currentSequenceExpression.expressions.splice(currentSequenceIndex, 1);
      });
   });
}

function generateModuleCode(currentDependencyName, dep, isTemplate, argumentsForClosure, voidInterfaces) {
   const useStrict = isTemplate ? '' : '"use strict";';
   const foundVoidInterfaces = {};
   voidInterfaces.forEach((curInterface) => {
      const currentIndex = dep.dependencies.indexOf(curInterface);
      if (currentIndex !== -1) {
         foundVoidInterfaces[curInterface] = currentIndex;
      }
      dep.dependencies.includes(curInterface);
   });
   Object.keys(foundVoidInterfaces).forEach((currentVoidInterface) => {
      const currentParameters = dep.ast.params;
      const currentInterfaceIndex = foundVoidInterfaces[currentVoidInterface];
      if (currentInterfaceIndex < currentParameters.length) {
         const currentExportsIndexes = libPackHelpers.getExportsIndexesByValueName(
            dep.ast.body.body,
            libPackHelpers.getCommonVariablesNames(dep.dependencies, dep.ast),
            currentParameters[currentInterfaceIndex].name
         );

         removeFoundIndexes(currentExportsIndexes, dep.ast.body.body);
      }
   });
   const resultHasNoExports = libPackHelpers.hasNoExports(dep);

   const generatedResult = escodegen.generate(dep.ast);
   if (resultHasNoExports) {
      return `var ${currentDependencyName} = { __esModule: true }`;
   }
   return (
      `var ${currentDependencyName} = function() {
         ${useStrict}
         var exports = { };
         var result = (${generatedResult})(${argumentsForClosure});
         if (result instanceof Function) {
            return result;
         } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
            return result;
         } else {
            for (var property in result) {
               if (result.hasOwnProperty(property)) {
                  exports[property] = result[property];
               }
            }
         }
         return exports;
      }()`
   );
}

function isExportsObjectReturns(returnArgument) {
   return escodegen.generate(returnArgument) === 'exports';
}

/**
 * Получаем выражение для экспорта по конкретному имени экспортируемой переменной
 * в теле функции callback'а библиотеки, если такое существует.
 * @param {Array} elements
 * @param {String} valueName
 */
function getExportsIndexesByValueName(elements, valueName) {
   const result = [];

   elements.forEach((currentElement, index) => {
      if (currentElement.type !== Syntax.ExpressionStatement) {
         return;
      }

      const currentExpression = currentElement.expression;
      if (!currentExpression.right || currentExpression.right.name !== valueName) {
         return;
      }

      const shouldIgnore = (
         !currentExpression.left ||
         !(currentExpression.left.object && currentExpression.left.object.name === 'exports')
      );

      if (shouldIgnore) {
         return;
      }

      result.push(index);
   });
   return result;
}

/**
 * Возвращает путь до исходного ES файла для анализируемой зависимости.
 * @param {string} sourceRoot - корень UI-исходников
 * @param {array<string>} privateModulesCache - кэш из taskParameters.cache для приватных модулей
 * @param {string} moduleName - имя анализируемой зависимости
 * @returns {string}
 */
function getSourcePathByModuleName(sourceRoot, privateModulesCache, moduleName) {
   let result = null;

   Object.keys(privateModulesCache).forEach((cacheName) => {
      if (privateModulesCache[cacheName].nodeName === moduleName) {
         result = cacheName;
      }
   });

   // если не нашли исходник для приватной зависимости в esModulesCache,
   // значит приватная зависимость - это js-модуль в ES5 формате.
   if (!result) {
      result = `${path.join(sourceRoot, moduleName)}.js`;
   }

   return result;
}

function generateLibrary(ast, options, libraryWarnings) {
   const {
      externalDependenciesToPush,
      libraryDependencies,
      libraryParametersNames,
      functionCallbackBody,
      topLevelReturnStatement,
      exportsDefine,
      libraryDependenciesMeta,
      sourceRoot,
      libraryName,
      privateDependenciesOrder,
      privatePartsForCache,
      privateModulesCache
   } = options;

   // производим непосредственно сами манипуляции с библиотекой:
   // 1) Добавляем в зависимости библиотеки внешние зависимости приватных частей библиотеки, если их нет в списке.
   // 2) Выкидываем из зависимостей библиотеки все приватные её части, уменьшая таким образом Стэк requirejs.
   // 3) Обьявляем сами приватные части библиотеки внутри неё и экспортируем наружу вместе с исходным экспортируемым
   // библиотекой объектом.
   traverse(ast, {
      enter(node) {
         if (node.type === Syntax.CallExpression && node.callee.type === Syntax.Identifier && node.callee.name === 'define') {
            const currentReturnExpressions = [];

            libPackHelpers.addExternalDepsToLibrary(
               externalDependenciesToPush,
               libraryDependencies,
               libraryDependenciesMeta,
               libraryParametersNames
            );

            let packIndex;
            if (exportsDefine.position) {
               removeStrictModeStatement(functionCallbackBody, topLevelReturnStatement, exportsDefine);

               packIndex = exportsDefine.position + 1;

               if (topLevelReturnStatement) {
                  const returnArgument = topLevelReturnStatement.statement.argument;

                  // надо проверить, что возвращается exports, иначе кидать ошибку.
                  if (!isExportsObjectReturns(returnArgument)) {
                     logger.error({
                        message: 'Библиотека в случае использования механизма exports должна возвращать в качестве результата именно exports',
                        filePath: `${path.join(sourceRoot, libraryName)}.js`
                     });
                  }

                  functionCallbackBody.body.splice(
                     topLevelReturnStatement.position,
                     1
                  );
               }
            } else {
               libraryWarnings.push('exports variable wasn\'t found in current library. Please use classic exports in it to export your library API!');
               let exportsObject;

               packIndex = 0;
               removeStrictModeStatement(functionCallbackBody, topLevelReturnStatement);

               if (topLevelReturnStatement) {
                  const returnArgument = topLevelReturnStatement.statement.argument;

                  exportsObject = escodegen.generate(returnArgument);

                  // в случае если возвращается последовательность операций, оборачиваем его
                  // и присваиваем exports результат выполнения этой последовательности операций
                  // Актуально для ts-конструкций вида "exports = {<перечисление экспортируемых свойств>}"
                  if (topLevelReturnStatement.returnsType === Syntax.SequenceExpression) {
                     exportsObject = `(${exportsObject})`;
                  }

                  functionCallbackBody.body.splice(
                     topLevelReturnStatement.position,
                     1
                  );
               } else {
                  exportsObject = '{}';
               }
               currentReturnExpressions.push(`var exports = ${exportsObject};`);
            }

            const voidInterfaces = [];
            privateDependenciesOrder.forEach((dep) => {
               let libDependenciesList = libraryDependencies.map(dependency => dependency.value);
               let privateDependencyIndex = libDependenciesList.indexOf(dep.moduleName);
               if (dep.hasNoExports) {
                  voidInterfaces.push(dep.moduleName);
                  while (privateDependencyIndex !== -1) {
                     // remove all exports of interfaces because they are useless and cause
                     // traffic degradation on a client side
                     if (privateDependencyIndex < libraryParametersNames.length) {
                        const currentExportsIndexes = libPackHelpers.getExportsIndexesByValueName(
                           functionCallbackBody.body,
                           libPackHelpers.getCommonVariablesNames([]),
                           libraryParametersNames[privateDependencyIndex].name
                        );

                        removeFoundIndexes(currentExportsIndexes, functionCallbackBody.body);
                     }

                     // remove private dependency from deps list and callback params list
                     libPackHelpers.deletePrivateDepsFromList(
                        privateDependencyIndex,
                        libraryDependencies,
                        libraryParametersNames
                     );

                     // get actual list of dependencies and params
                     libDependenciesList = libraryDependencies.map(dependency => dependency.value);
                     privateDependencyIndex = libDependenciesList.indexOf(dep.moduleName);
                  }
                  return;
               }

               const argumentsForClosure = dep.dependencies
                  .map((dependency) => {
                     if (libraryDependenciesMeta[dependency].hasNoExports) {
                        return '{}';
                     }
                     const currentDependencyName = dependency.replace(invalidCharsForVariable, '_');
                     if (libraryDependenciesMeta[dependency].hasNoExports) {
                        return '{}';
                     }

                     libraryDependenciesMeta[dependency].names.push(
                        `typeof ${currentDependencyName} === 'undefined' ? null : ${currentDependencyName}`
                     );

                     if (libPackHelpers.isPrivate(dependency) && !dependency.startsWith('i18n!')) {
                        return `${libraryDependenciesMeta[dependency].names[0]}`;
                     }

                     return libraryDependenciesMeta[dependency].names[0];
                  });

               /**
                * Для каждой приватной части библиотеки обеспечиваем уникальность имени, поскольку
                * импорт 2х разных модулей может компилироваться для typescript в 1 переменную. Нам
                * нужно обеспечить уникальность имён для приватных частей библиотеки.
                */
               const currentDependencyName = dep.moduleName.replace(invalidCharsForVariable, '_');

               libraryDependenciesMeta[dep.moduleName].names.unshift(currentDependencyName);

               try {
                  functionCallbackBody.body.splice(
                     packIndex,
                     0,
                     parseCode(`exports['${dep.moduleName}'] = true;`)
                  );

                  packIndex++;
               } catch (error) {
                  throw new Error(
                     `espree error: cant parse Javascript code: exports['${dep.moduleName}'] = true;\n` +
                     `Error message: ${error.message} \n` +
                     `Stack: ${error.stack}`
                  );
               }

               // Проверяем зависимость на принадлежность к шаблонам, не вставлем use strict.
               const isTemplate = dep.moduleName.startsWith('tmpl!') || dep.moduleName.startsWith('wml!');
               const moduleCode = generateModuleCode(
                  currentDependencyName,
                  dep,
                  isTemplate,
                  argumentsForClosure,
                  voidInterfaces
               );

               try {
                  functionCallbackBody.body.splice(
                     packIndex,
                     0,
                     parseCode(moduleCode)
                  );

                  packIndex++;
               } catch (error) {
                  throw new Error(
                     `espree error: cant parse generated code for private library part: ${moduleCode}\n` +
                     `Error message: ${error.message} \n` +
                     `Stack: ${error.stack}`
                  );
               }

               // Одна приватная зависимость может быть заимпорчена несколько раз.
               // Например когда делается export нескольких сущностей из 1-го модуля.
               // Поэтому нам нужно вычистить также все найденные дубли.
               while (privateDependencyIndex !== -1) {
                  const currentParameterName = (
                     libraryParametersNames[privateDependencyIndex] &&
                     libraryParametersNames[privateDependencyIndex].name
                  );
                  const defaultParameterName = libraryDependenciesMeta[dep.moduleName].names[0];

                  // если нашлись дополнительные дублирующие зависимости, то все переменные, с которыми она была
                  // передана в callback, делаем алиасами от самой первой переменной
                  if (
                     privateDependencyIndex < libraryParametersNames.length &&
                     currentParameterName !== defaultParameterName
                  ) {
                     if (nativeJavascriptNames.includes(libraryParametersNames[privateDependencyIndex].name)) {
                        const statementIndexes = getExportsIndexesByValueName(
                           functionCallbackBody.body,
                           libraryParametersNames[privateDependencyIndex].name
                        );

                        statementIndexes.forEach((currentIndex) => {
                           const [nameInLibrary] = libraryDependenciesMeta[dep.moduleName].names;
                           functionCallbackBody.body[currentIndex].expression.right.name = nameInLibrary;
                        });
                     } else {
                        const aliasCode = `var ${libraryParametersNames[privateDependencyIndex].name} = ${libraryDependenciesMeta[dep.moduleName].names[0]};`;

                        try {
                           functionCallbackBody.body.splice(
                              packIndex,
                              0,
                              parseCode(aliasCode)
                           );

                           packIndex++;
                        } catch (error) {
                           throw new Error(
                              `espree error: cant parse generated code for alias: ${aliasCode}\n` +
                              `Error message: ${error.message} \n` +
                              `Stack: ${error.stack}`
                           );
                        }
                     }
                  }

                  // удаляем приватную зависимость из зависимостей библиотеки и её передачу в callback
                  libPackHelpers.deletePrivateDepsFromList(
                     privateDependencyIndex,
                     libraryDependencies,
                     libraryParametersNames
                  );

                  // достаём свежий список зависимостей и аргументов
                  libDependenciesList = libraryDependencies.map(dependency => dependency.value);
                  privateDependencyIndex = libDependenciesList.indexOf(dep.moduleName);
               }
            });

            functionCallbackBody.body.push(parseCode(currentReturnExpressions.join('\n')));
            functionCallbackBody.body.push({
               'type': Syntax.ReturnStatement,
               'argument': {
                  'type': Syntax.Identifier,
                  'name': 'exports'
               }
            });

            this.break();
         }
      }
   });

   const libraryResult = {
      compiled: escodegen.generate(ast),
      newModuleDependencies: libraryDependencies.map(object => object.value),
      name: libraryName,
      warnings: libraryWarnings
   };

   if (privatePartsForCache.length > 0) {
      libraryResult.fileDependencies = [];
      libraryResult.packedModules = [];

      privatePartsForCache.forEach((dependency) => {
         if (dependency.sourcePath) {
            libraryResult.fileDependencies.push(dependency.sourcePath);
         } else {
            libraryResult.fileDependencies.push(
               getSourcePathByModuleName(sourceRoot, privateModulesCache, dependency.moduleName)
            );
         }
         libraryResult.packedModules.push(dependency.moduleName);

         if (dependency.versioned) {
            libraryResult.versioned = true;
         }

         if (dependency.cdnLinked) {
            libraryResult.cdnLinked = true;
         }
      });
   }

   return libraryResult;
}

module.exports = {
   generateLibrary,
   getSourcePathByModuleName
};
