/**
 * Detects all basic interfaces and theirs providers and packs them .
 * @author Kolbeshin F.A.
 */

'use strict';

const pMap = require('p-map');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../../../lib/logger').logger();
const esprima = require('esprima');
const escodegen = require('escodegen');
const { traverse } = require('estraverse');

/**
 * Checks AST of provider code for base interface dependency and
 * replace its name with an alias if it actually exists.
 * @param ast
 * @param baseInterfaceName
 * @returns {boolean}
 */
function checkProviderForBaseInterfaceDep(ast, baseInterfaceName) {
   let result = false;
   traverse(ast, {
      enter(node) {
         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            let dependencies, interfaceNameIndex;
            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case 'ArrayExpression':
                     dependencies = argument.elements.map(element => element.value);
                     interfaceNameIndex = dependencies.indexOf(baseInterfaceName);
                     if (interfaceNameIndex !== -1) {
                        result = true;
                        argument.elements[interfaceNameIndex].value = `${baseInterfaceName}_old`;
                        argument.elements[interfaceNameIndex].raw = `"${baseInterfaceName}_old"`;
                     }
                     break;
                  default:
                     break;
               }
            });
            this.break();
         }
      }
   });
   return result;
}

async function processOriginBaseInterface(output, currentInterface, providerHasInterfaceDep, extension) {
   let baseInterfaceContent = '';

   if (providerHasInterfaceDep) {
      let baseInterfacePath = path.join(output, `${currentInterface}${extension}`);
      if (await fs.pathExists(baseInterfacePath.replace('.js', '.original.js'))) {
         baseInterfacePath = baseInterfacePath.replace('.js', '.original.js');
      }
      baseInterfaceContent = await fs.readFile(baseInterfacePath, 'utf8');
      baseInterfaceContent = baseInterfaceContent.replace(
         `define("${currentInterface}"`,
         `define("${currentInterface}_old"`
      );
      if (!baseInterfaceContent.endsWith('\n')) {
         baseInterfaceContent += '\n';
      }
   }

   return baseInterfaceContent;
}

async function processBaseInterfaceContent(output, aliasContent, currentInterface, lastProvider, extension) {
   const providedContent = await fs.readFile(path.join(output, `${lastProvider}${extension}`), 'utf8');
   const providedAst = esprima.parse(providedContent);
   const providerHasInterfaceDep = checkProviderForBaseInterfaceDep(providedAst, currentInterface);
   const baseInterfaceContent = await processOriginBaseInterface(
      output,
      currentInterface,
      providerHasInterfaceDep,
      extension
   );

   await fs.outputFile(
      path.join(output, `${currentInterface}${extension}`),
      baseInterfaceContent + aliasContent + escodegen.generate(
         providedAst,
         extension === '.min.js' ? { format: { compact: true } } : null
      )
   );
}

module.exports = function generateTaskForInterfacePacking(taskParameters) {
   return async function packInterfaces() {
      const output = taskParameters.config.outputPath;
      const { interfaces, isReleaseMode } = taskParameters.config;
      await pMap(
         interfaces.required,
         async(currentInterface) => {
            const currentProviders = Object.keys(interfaces.provided).filter(
               currentKey => interfaces.provided[currentKey] === currentInterface
            ).sort((first, second) => {
               const firstIndex = interfaces.providedOrder.indexOf(first);
               const secondIndex = interfaces.providedOrder.indexOf(second);
               return firstIndex - secondIndex;
            });
            if (currentProviders.length > 0) {
               const lastProvider = currentProviders.pop();
               const callbackName = lastProvider.split('/').pop();

               // create an alias for provider in base interface module and return it as a result
               const aliasContent = `define("${currentInterface}",` +
                  `["${lastProvider}"],` +
                  `function(${callbackName}) {` +
                  `return ${callbackName}; });\n`;

               await processBaseInterfaceContent(
                  output,
                  aliasContent,
                  currentInterface,
                  lastProvider,
                  '.js'
               );
               if (isReleaseMode) {
                  await processBaseInterfaceContent(
                     output,
                     aliasContent,
                     currentInterface,
                     lastProvider,
                     '.min.js'
                  );
               }
            } else {
               const moduleInfo = taskParameters.config.modules.find(module => module.name === currentInterface.split('/').shift());
               logger.error({
                  message: `There is no available provider of base interface ${currentInterface} in current project`,
                  filePath: currentInterface,
                  moduleInfo
               });
            }
         },
         {
            concurrency: 50
         }
      );
   };
};
