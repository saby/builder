'use strict';

const SPECIAL_DEPENDENCIES = ['require', 'exports', 'module'];
const REQUIRE_NAME = 'global.requirejs';

const ESPRIMA_PARSE_OPTIONS = {
   attachComment: true,
   range: true,
   source: true
};
const QUOTES_TYPE = 'double';
const ES_GENERATOR_OPTIONS = {
   format: {
      compact: false,
      quotes: QUOTES_TYPE,
      parentheses: true,
      semicolons: true
   }
};
const ES_GENERATOR_OPTIONS_COMPACT = {
   ...ES_GENERATOR_OPTIONS,
   format: {
      ...ES_GENERATOR_OPTIONS.format,
      compact: true
   }
};

function wrapWithQuotes(text) {
   if (QUOTES_TYPE === 'double') {
      return `"${text}"`;
   }

   return `'${text}'`;
}

function createIdentifierName(name) {
   const letter = name.charAt(0).replace(/[^_$a-z]/gi, '_');
   const tail = name.slice(1).replace(/[^_$a-z0-9]/gi, '_');

   return letter + tail;
}

function createFactoryArgument(dependency, create = createIdentifierName) {
   if (dependency === 'require') {
      return REQUIRE_NAME;
   }

   if (dependency === 'module') {
      return 'module';
   }

   if (dependency === 'exports') {
      return 'module.exports';
   }

   return create(dependency);
}

module.exports = {
   SPECIAL_DEPENDENCIES,
   REQUIRE_NAME,
   ESPRIMA_PARSE_OPTIONS,
   ES_GENERATOR_OPTIONS,
   ES_GENERATOR_OPTIONS_COMPACT,
   wrapWithQuotes,
   createIdentifierName,
   createFactoryArgument
};
