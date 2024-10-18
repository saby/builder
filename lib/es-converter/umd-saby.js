'use strict';

const {
   SPECIAL_DEPENDENCIES,
   REQUIRE,
   genRequire
} = require('./require');
const amd = require('./amd');
const umd = require('./umd');

const DYNAMIC_DEPENDENCIES_IDENT = '__deps';

function filterDependencies(dependencies) {
   return dependencies.filter(dependency => !SPECIAL_DEPENDENCIES.includes(dependency));
}

function createIdentifierName(name) {
   const letter = name.charAt(0).replace(/[^_$a-z]/gi, '_');
   const tail = name.slice(1).replace(/[^_$a-z0-9]/gi, '_');

   return letter + tail;
}

function createDependencyDecl(dependency) {
   const identName = createIdentifierName(dependency);
   const initValue = genRequire(dependency);

   return `${identName} = ${initValue};`;
}

const wrapDynamicDeps = eMsg => (`
      try {
         ${DYNAMIC_DEPENDENCIES_IDENT} = ${DYNAMIC_DEPENDENCIES_IDENT}.map(function(name) {
            if (name === 'require')
               return (${REQUIRE} || require);
            if (name === 'module')
               return module;
            if (name === 'exports')
               return module.exports;
            return (${REQUIRE} || require)(name);
         });
      } catch (error) {
         throw new Error(${eMsg} + error);
      }\
`);

const wrapBeforeFactoryCall = (ids, decls, eMsg) => (`
      var ${ids.join(', ')};
      try {
         ${decls.join('\n         ')}
      } catch (error) {
         throw new Error(${eMsg} + error);
      }\
`);

const wrap = (defineStatement, beforeFactoryCall, factoryArguments, factory) => (`(function(factory) {
   if (typeof define === "function" && define.amd) {
      ${defineStatement};
   } else if (typeof module === "object" && typeof module.exports === "object") {${beforeFactoryCall}
      var v = factory(${factoryArguments});
      if (v !== undefined)
         module.exports = v;
   }
})(${factory});`);

const wrapDynamic = (dependenciesCall, defineStatement, beforeFactoryCall, factory) => (`(function(factory) {
   var ${DYNAMIC_DEPENDENCIES_IDENT} = (${dependenciesCall});
   if (typeof define === "function" && define.amd) {
      ${defineStatement};
   } else if (typeof module === "object" && typeof module.exports === "object") {${beforeFactoryCall}
      var v = factory.apply(undefined, ${DYNAMIC_DEPENDENCIES_IDENT});
      if (v !== undefined)
         module.exports = v;
   }
})(${factory});`);

function generateFactoryIdentifiers(dependencies) {
   return dependencies.map(dependency => genRequire(dependency, createIdentifierName));
}

function createDependenciesErrorTemplate(moduleName) {
   const title = 'Ошибка загрузки зависимостей';

   if (moduleName) {
      return `"${title} в модуле '${moduleName}': "`;
   }

   return `"${title}: "`;
}

function generatePreloadBlock(dependencies, moduleName) {
   const realDeps = filterDependencies(dependencies);

   if (realDeps.length === 0) {
      return '';
   }

   const identifiers = realDeps.map(dependency => createIdentifierName(dependency));
   const dependenciesDecls = realDeps.map(dependency => createDependencyDecl(dependency));

   return wrapBeforeFactoryCall(
      identifiers,
      dependenciesDecls,
      createDependenciesErrorTemplate(moduleName)
   );
}

function formatStatic(components) {
   const defineStatement = amd.formatDefine(
      components.moduleName,
      components.dependencies,
      'factory'
   );

   if (!Array.isArray(components.dependencies)) {
      return wrap(
         defineStatement,
         '',
         '',
         components.factory
      );
   }

   const factoryArguments = generateFactoryIdentifiers(components.dependencies);
   const beforeFactoryCall = generatePreloadBlock(
      components.dependencies,
      components.moduleName
   );

   return wrap(
      defineStatement,
      beforeFactoryCall,
      factoryArguments,
      components.factory
   );
}

function formatDynamic(components) {
   const defineStatement = amd.formatDefine(
      components.moduleName,
      DYNAMIC_DEPENDENCIES_IDENT,
      'factory'
   );
   const beforeFactoryCall = wrapDynamicDeps(
      createDependenciesErrorTemplate(components.moduleName)
   );

   return wrapDynamic(
      components.dependenciesCall,
      defineStatement,
      beforeFactoryCall,
      components.factory
   );
}

function format(components) {
   if (components.dependenciesCall) {
      return formatDynamic(components);
   }

   return formatStatic(components);
}

module.exports = {
   format,
   formatClassic: umd.format,
   parse: umd.parse
};
