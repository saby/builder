'use strict';

const { path, toPosix } = require('../../lib/platform/path');
const { Syntax } = require('espree');
const { traverse } = require('estraverse');

/**
 * Проверка модуля на соответствие всем требованиям приватных модулей.
 * @param{String} dependency - анализируемый модуль
 * @returns {boolean}
 */
function isPrivate(dependency) {
   // Remove interface module name part from checking and remove module name,
   // module can be private only if located in folder with "_" prefix.
   // Modules with "_" prefix in name only are declared as public.

   return toPosix(dependency)
      .split(path.sep)
      .slice(1, -1)
      .some(part => part.startsWith('_'));
}

/**
 * Проверка кода библиотеки на наличие использования конструкции exports
 * @param{Object} functionCallBack - ast-дерево функции callback'а соответствующей библиотеки
 * @returns {{ position: (Number|null)}}
 */
function checkForDefineExportsProperty(functionCallBack) {
   const treeHasExportsDefine = {
      position: null
   };

   functionCallBack.body.forEach((node, index) => {
      const expressionCallee = node.expression && node.expression.callee;
      const expressionArguments = node.expression && node.expression.arguments;

      if (node.type === Syntax.ExpressionStatement && expressionCallee &&

         // Object.defineProperty(exports, '__esModule', ...);
         (expressionCallee.object && expressionCallee.object.name === 'Object') &&
         (expressionCallee.property && expressionCallee.property.name === 'defineProperty') && expressionArguments &&
         (expressionArguments[0] && expressionArguments[0].name === 'exports') &&
         (expressionArguments[1] && expressionArguments[1].value === '__esModule')
      ) {
         treeHasExportsDefine.position = index;
      }
   });

   return treeHasExportsDefine;
}

/**
 * Достаём из полученного ранее ast-дерева библиотеки набор данных,
 * необходимых для дальнейшей работы с библиотекой:
 * 1)libraryDependencies - набор зависимостей самой библиотеки
 * 2)libraryDependenciesMeta - мета-данные о каждой зависимости библиотеки
 * и всех других анализируемых модулях
 * 3)libraryParametersNames - набор зависимостей функции callback'а библиотеки
 * 4)functionCallbackBody - тело функции callback'а библиотеки в ast-формате.
 * 5)exportsDefine - используется ли конструкция exports в библиотеке
 * 6)topLevelReturnStatement - return верхнего уровня функции callback'а библиотеки
 * 7)libraryName - имя самой библиотеки

 * @param{Object} ast - ast-дерево анализируемой библиотеки
 * @returns{String} возвращает сгенерированный код библиотеки.
 */
function getLibraryMeta(ast) {
   const libraryMeta = { };

   traverse(ast, {
      enter(node) {
         if (node.type === Syntax.CallExpression && node.callee.type === Syntax.Identifier && node.callee.name === 'define') {
            const libraryDependenciesMeta = { };

            let dependencies, paramsNames, libraryName, returnStatement;

            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case Syntax.ArrayExpression:
                     dependencies = argument.elements.map(element => element.value);
                     libraryMeta.libraryDependencies = argument.elements;
                     break;

                  case Syntax.FunctionExpression:
                     paramsNames = argument.params.map(param => param.name);
                     dependencies.forEach((dependency) => {
                        const currentParamName = paramsNames[dependencies.indexOf(dependency)];

                        if (!libraryDependenciesMeta.hasOwnProperty(dependency)) {
                           libraryDependenciesMeta[dependency] = {
                              names: []
                           };
                        }

                        if (currentParamName) {
                           if (!libraryDependenciesMeta[dependency].names.includes(currentParamName)) {
                              libraryDependenciesMeta[dependency].names.push(currentParamName);
                           }
                        }

                        if (isPrivate(dependency)) {
                           libraryDependenciesMeta[dependency].isPrivate = true;
                        }
                     });

                     argument.body.body.forEach((expression, index) => {
                        if (expression.type === Syntax.ReturnStatement) {
                           returnStatement = {
                              statement: expression,
                              position: index,
                              returnsType: expression.argument.type
                           };
                        }
                     });

                     libraryMeta.libraryParametersNames = argument.params;
                     libraryMeta.functionCallbackBody = argument.body;
                     libraryMeta.exportsDefine = checkForDefineExportsProperty(libraryMeta.functionCallbackBody);

                     if (returnStatement) {
                        libraryMeta.topLevelReturnStatement = returnStatement;
                     }
                     break;

                  case Syntax.Literal:
                     libraryName = argument.value;
                     break;

                  default:
                     break;
               }
            });

            libraryMeta.libraryDependenciesMeta = libraryDependenciesMeta;
            libraryMeta.libraryName = libraryName;

            this.break();
         }
      }
   });

   return libraryMeta;
}

function collectDependencies(moduleAst, normalizedCurrentDependency, result) {
   let dependenciesNames = [];

   traverse(moduleAst, {
      enter(node) {
         if (node.type === Syntax.CallExpression && node.callee.type === Syntax.Identifier && node.callee.name === 'define') {
            if (node.arguments.length > 0 && node.arguments[0].type === Syntax.Literal) {
               if (node.arguments[0].value !== normalizedCurrentDependency) {
                  // Found module is not needed one. Continue searching.
                  return;
               }
            }

            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case Syntax.ArrayExpression:
                     result.dependencies = argument.elements.map(element => element.value);
                     break;

                  case Syntax.FunctionExpression:
                     dependenciesNames = argument.params.map(param => param.name);
                     result.ast = argument;
                     break;

                  default:
                     break;
               }
            });

            this.break();
         }
      }
   });

   return dependenciesNames;
}

/**
 * Проверяем передаваемое имя для зависимости на уникальность
 * в общем списке аргументов библиотеки:
 * 1) Если имя уникально, возвращаем его.
 * 2) Если имя дублируется:
 *    2.1)добавляем счётчик по аналогии с компиляцией typescript,
 *    проверяем на уникальность. Если ок, возвращаем. Если нет,
 *    увеличиваем счётчик.
 *    2.2)повторяем процедуру, пока не будет получено уникальное имя
 *    для переменной.
 */
function getUniqueParamName(paramName, libraryParametersNames, dependencyMeta) {
   const libraryParametersList = libraryParametersNames.map(param => param.name);

   if (libraryParametersList.includes(paramName)) {
      let
         counter = 1,
         newParamName,
         isUniqueName = false;
      while (!isUniqueName) {
         newParamName = `${paramName}_${counter}`;
         isUniqueName = !libraryParametersList.includes(newParamName);
         counter++;
      }

      // не забываем добавить
      dependencyMeta.names.unshift(newParamName);
      return newParamName;
   }
   return paramName;
}

/**
 * добавляем зависимости приватных частей библиотеки непосредственно
 * в зависимости самой библиотеки, если их самих ещё нет.
 * @param{Array} externalDependenciesToPush - набор внешних зависимостей, от которых зависимости
 * приватные модули библиотеки
 * @param{Array} libraryDependencies - набор зависимостей библиотеки.
 * @param{Object} libraryDependenciesMeta - мета-данные всех зависимостей библиотеки и зависимостей
 * всех её приватных частей.
 * @param{Array} libraryParametersNames - набор аргументов функции callback'а библиотеки
 */
function addExternalDepsToLibrary(
   externalDependenciesToPush,
   libraryDependencies,
   libraryDependenciesMeta,
   libraryParametersNames
) {
   // sort external dependencies to push into library to avoid problems with different order in patch and full build
   externalDependenciesToPush.sort().forEach((externalDependency) => {
      const paramName = libraryDependenciesMeta[externalDependency].names[0];
      const dependencyNameAst = {
         type: Syntax.Literal,
         value: `${externalDependency}`,
         raw: `"${externalDependency}"`
      };

      const dependencyIndex = libraryDependencies.findIndex(element => element.value === externalDependency);

      if (dependencyIndex === -1) {
         // css dependencies always should be at the end of dependencies list
         if (paramName && !externalDependency.startsWith('css!')) {
            libraryDependencies.unshift(dependencyNameAst);
            libraryParametersNames.unshift({
               type: Syntax.Identifier,
               name: `${getUniqueParamName(paramName, libraryParametersNames, libraryDependenciesMeta[externalDependency])}`
            });
         } else {
            libraryDependencies.push(dependencyNameAst);
         }
      } else {
         const isUnusedDependency = dependencyIndex >= libraryParametersNames.length;
         if (isUnusedDependency) {
            libraryDependencies.splice(dependencyIndex, 1);
            if (paramName && !externalDependency.startsWith('css!')) {
               libraryDependencies.unshift(dependencyNameAst);
               libraryParametersNames.unshift({
                  type: Syntax.Identifier,
                  name: `${getUniqueParamName(paramName, libraryParametersNames, libraryDependenciesMeta[externalDependency])}`
               });
            } else {
               libraryDependencies.push(dependencyNameAst);
            }
         }
      }
   });
}

module.exports = {
   isPrivate,
   getLibraryMeta,
   collectDependencies,
   addExternalDepsToLibrary
};
