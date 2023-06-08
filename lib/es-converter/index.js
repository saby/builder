/**
 * @author Krylov M.A.
 */

'use strict';

const amd = require('./amd');
const umd = require('./umd-saby');
const patch = require('./patch');
const modify = require('./modifier');
const sm = require('../source-map');
const helpers = require('./helpers');

const toDefaultFactory = content => `function(require, exports, module) {
${content}
}`;

function formatUnknown(components, targetModule) {
   // tsc не оборачивает в amd/umd, если, например, модуль не содержит export выражений.
   // для amd необходимо сделать обертку, а umd отдать как есть.
   if (targetModule === 'umd') {
      return components.factory;
   }

   return amd.format({
      moduleName: components.moduleName,
      dependencies: ['require', 'exports', 'module'],
      factory: toDefaultFactory(components.factory)
   });
}

function format(components, target) {
   const targetModule = target.toLowerCase();

   if (!components.originModule && !components.moduleName.endsWith('.routes')) {
      return formatUnknown(components, targetModule);
   }

   if (targetModule === 'umd') {
      if (components.originModule === 'umd') {
         return umd.formatClassic(components);
      }

      return umd.format(components);
   }

   if (components.originModule === 'amd') {
      return amd.format(components);
   }

   return amd.format({
      ...components,
      factory: components.cleanFactory || components.factory,
      dependencies: components.cleanDependencies || components.dependencies
   });
}

function compile(components, target) {
   return (
      components.leadingData +
      format(components, target) +
      components.trailingData
   );
}

async function generateSourceMap(components, target) {
   const fragment = '/*#*-FACTORY-FUNCTION-*#*/';
   const fragmentCode = compile(
      {
         ...components,
         factory: fragment,
         cleanFactory: fragment
      },
      target
   );
   const factoryLocation = helpers.calculateLocation(fragmentCode, fragment);

   if (factoryLocation.line === components.factoryLocation.start.line) {
      return components.sourceMap;
   }

   const smModifier = new sm.SourceMapModifier();
   await smModifier.initialize(components.sourceMap);

   smModifier.moveMappings(
      components.factoryLocation.start,
      components.factoryLocation.end,
      factoryLocation.line - components.factoryLocation.start.line
   );
   smModifier.process();

   return smModifier.sourceMapJson;
}

async function generate(components, target) {
   const code = compile(components, target);

   if (!components.sourceMap || !components.factoryLocation) {
      return { code };
   }

   const sourceMap = await generateSourceMap(components, target);

   if (components.inlineSourceMap) {
      return {
         code: code + sm.toComment(sourceMap)
      };
   }

   return {
      code,
      sourceMap
   };
}

function parse(program, options) {
   const meta = amd.parse(program) || umd.parse(program);

   if (meta) {
      meta.sourceMap = meta.sourceMap || options.sourceMap;

      return meta;
   }

   if (options.isCompiledFromTsc && !options.isRoutesFile) {
      return {
         factory: program
      };
   }

   return undefined;
}

async function convert(program, source, target, options) {
   const result = {
      hasError: true
   };

   try {
      const [pProgram, pSource] = patch(program, source, options);
      const meta = parse(pProgram, options);

      if (!meta || meta.hasError) {
         return result;
      }

      const components = modify(pProgram, pSource, meta, options);
      const targets = Array.isArray(target) ? target : [target];
      for (const moduleName of targets) {
         // eslint-disable-next-line no-await-in-loop
         const { code, sourceMap } = await generate(components, moduleName);

         result[moduleName] = code;

         if (sourceMap) {
            result[`${moduleName}SourceMap`] = sourceMap;
         }
      }

      result.hasError = false;
   } catch (error) {
      result.error = error;
   }

   return result;
}

module.exports = convert;
module.exports.parse = parse;
module.exports.modify = modify;
module.exports.compile = compile;
