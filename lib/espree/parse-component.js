'use strict';

const { Syntax } = require('espree');
const { traverse } = require('estraverse');
const { isPrivate } = require('./library');

const NAME_NAVIGATION = /(optional!)?(Navigation\/NavigationController)$/;

function findExpression(node, left) {
   return (
      node.type === Syntax.ExpressionStatement &&
      node.expression &&
      node.expression.type === Syntax.AssignmentExpression &&
      node.expression.operator === '=' &&
      node.expression.left.type === Syntax.MemberExpression &&
      node.expression.left.property.name === left &&
      node.expression.left.object &&
      node.expression.left.object.type === Syntax.Identifier
   );
}

function getPropertyName(property) {
   switch (property.key.type) {
      case Syntax.Literal:
         return property.key.value;

      case Syntax.Identifier:
         return property.key.name;

      default:
         return undefined;
   }
}

function collectArrayValues(array) {
   const result = [];

   if (array.type !== Syntax.ArrayExpression) {
      return result;
   }

   for (const element of array.elements) {
      result.push(element.value);
   }

   return result;
}

function parseObjectExpression(properties) {
   const obj = {};

   properties.forEach((prop) => {
      const propertyName = getPropertyName(prop);

      if (prop.value.type === Syntax.ArrayExpression) {
         obj[propertyName] = collectArrayValues(prop.value);
         return;
      }

      obj[propertyName] = prop.value.value;
   });

   return obj;
}

function getLessPropertyInObject(node) {
   // check node for object statement
   if (node.type !== Syntax.ObjectExpression && !node.properties) {
      return '';
   }

   const componentLess = new Set();

   node.properties.forEach((currentProperty) => {
      if (!(currentProperty.key && currentProperty.key.name)) {
         return;
      }

      // assignable value should be an Array only
      if (!(currentProperty.value && currentProperty.value.type === Syntax.ArrayExpression)) {
         return;
      }

      if (currentProperty.key.name === '_theme' || currentProperty.key.name === '_styles') {
         currentProperty.value.elements.forEach((currentElement) => {
            componentLess.add(currentElement.value);
         });
      }
   });

   return componentLess;
}

function getLessPropertyInAssignment(node) {
   // check node for assignment statement
   if (
      node.type !== Syntax.AssignmentExpression ||
      !(node.left && node.left.property && node.left.property.name)
   ) {
      return '';
   }

   // check for needed property name
   const propertyName = node.left.property.name;
   if (!(propertyName === '_theme' || propertyName === '_styles')) {
      return '';
   }

   // assignable value should be an Array only
   if (node.right.type !== Syntax.ArrayExpression) {
      return '';
   }

   const componentLess = new Set();

   node.right.elements.forEach((currentElement) => {
      if (!currentElement) {
         return;
      }
      if (currentElement.type !== Syntax.Literal) {
         return;
      }
      componentLess.add(currentElement.value);
   });

   return componentLess;
}

function gatherWebPageContent(webPageExpressions, returnStatement) {
   if (webPageExpressions.length === 0 || !returnStatement) {
      return undefined;
   }

   const opts = { };
   const webPage = { };

   webPageExpressions.forEach((expr) => {
      if (expr.left.object.name === returnStatement.name) {
         if (expr.right.type === Syntax.ObjectExpression) {
            opts[expr.left.property.name] = parseObjectExpression(expr.right.properties);
         } else {
            opts[expr.left.property.name] = expr.right.value;
         }
      }
   });

   if (!opts.hasOwnProperty('webPage')) {
      return undefined;
   }

   if (opts.webPage.hasOwnProperty('htmlTemplate') && opts.webPage.htmlTemplate) {
      webPage.htmlTemplate = opts.webPage.htmlTemplate.trim();
   }

   if (opts.webPage.hasOwnProperty('title') && opts.webPage.title) {
      webPage.title = opts.webPage.title;
   } else if (opts.hasOwnProperty('title') && opts.title) {
      webPage.title = opts.title;
   }

   if (opts.webPage.hasOwnProperty('outFileName') && opts.webPage.outFileName) {
      webPage.outFileName = opts.webPage.outFileName;
   }

   if (opts.webPage.hasOwnProperty('urls') && opts.webPage.urls) {
      webPage.urls = opts.webPage.urls;
   }

   return webPage;
}

function searchForLessProperty(node, lessDeps) {
   let lessSearchResult = getLessPropertyInAssignment(node);
   if (lessSearchResult) {
      lessSearchResult.forEach(less => lessDeps.add(less));
   }

   lessSearchResult = getLessPropertyInObject(node);
   if (lessSearchResult) {
      lessSearchResult.forEach(less => lessDeps.add(less));
   }
}

function checkForWebPageExpression(node, webPageExpressions) {
   const hasWebPageExpression = (
      findExpression(node, 'webPage') &&
      node.expression.right &&
      node.expression.right.type === Syntax.ObjectExpression
   );
   const hasTitleExpression = (
      findExpression(node, 'title') &&
      node.expression.right &&
      node.expression.right.type === Syntax.Literal
   );

   if (hasWebPageExpression) {
      webPageExpressions.push(node.expression);
   }
   if (hasTitleExpression) {
      webPageExpressions.push(node.expression);
   }
}

function processDefineArguments(node, result, testsBuild, lessDeps, returnStatement) {
   if (node.arguments[0].type === Syntax.Literal && typeof node.arguments[0].value === 'string') {
      result.componentName = node.arguments[0].value;
   }

   const index = node.arguments.length > 2 ? 1 : 0;
   if (
      node.arguments[index].type === Syntax.ArrayExpression &&
      node.arguments[index].elements instanceof Array
   ) {
      result.componentDep = [];
      node.arguments[index].elements.forEach((element) => {
         if (element && element.value) {
            result.componentDep.push(element.value);

            if (testsBuild && element.value.startsWith('css!')) {
               lessDeps.add(element.value.replace(/css!(theme\?)?/, ''));
            }

            if (isPrivate(element.value)) {
               result.privateDependencies = true;
            }
         }
      });
   }

   let fnNode = null;
   if (node.arguments[1] && node.arguments[1].type === Syntax.FunctionExpression) {
      fnNode = node.arguments[1].body;
   } else if (node.arguments[2] && node.arguments[2].type === Syntax.FunctionExpression) {
      fnNode = node.arguments[2].body;
   }

   if (fnNode && fnNode.body && fnNode.body instanceof Array) {
      fnNode.body.forEach((i) => {
         if (i.type === Syntax.ReturnStatement) {
            returnStatement.value = i.argument;
         }
      });
   }
}

function parseComponent(ast, options = {}) {
   const { testsBuild } = options;
   const result = { };
   const returnStatement = {};
   const webPageExpressions = [];

   // less-dependencies can be defined several times in different parts of current component
   // We need to collect all entries for entire component to get whole coverage map of less
   const lessDeps = new Set();

   traverse(ast, {
      enter(node) {
         if (testsBuild) {
            searchForLessProperty(node, lessDeps);
         }

         checkForWebPageExpression(node, webPageExpressions);

         const hasDefineExpression = (
            node.type === Syntax.CallExpression &&
            node.callee.type === Syntax.Identifier &&
            node.callee.name === 'define'
         );

         if (!hasDefineExpression) {
            return;
         }

         processDefineArguments(node, result, testsBuild, lessDeps, returnStatement);
      }
   });

   const webPage = gatherWebPageContent(webPageExpressions, returnStatement.value);

   if (webPage) {
      result.webPage = webPage;
   }

   if (lessDeps.size > 0) {
      result.lessDependencies = Array.from(lessDeps);
   }

   if (result.hasOwnProperty('componentDep') && result.componentName) {
      result.isNavigation = result.componentDep.some(name => NAME_NAVIGATION.test(name));
   }

   return result;
}

module.exports = parseComponent;
