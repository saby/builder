/**
 * Модуль модификации source map при изменении сгенерированного кода.
 * @author Krylov M.A.
 */

'use strict';

const { SourceMapGenerator, SourceMapConsumer } = require('source-map');

const { toComment } = require('./helpers');

function isInRange(mapping, startLocation, endLocation) {
   if (mapping.generatedLine > startLocation.line && mapping.generatedLine < endLocation.line) {
      return true;
   }

   if (mapping.generatedLine === startLocation.line) {
      return mapping.generatedColumn >= startLocation.column;
   }

   if (mapping.generatedLine === endLocation.line) {
      return mapping.generatedColumn <= endLocation.column;
   }

   return false;
}

async function getSourceMapData(sourceMapJson) {
   const consumer = await new SourceMapConsumer(sourceMapJson);
   const { file, sourceRoot } = consumer;

   const mappings = [];
   const sources = [];
   consumer.eachMapping((mapping) => {
      mappings.push(mapping);

      if (!sources.includes(mapping.source)) {
         sources.push(mapping.source);
      }
   });

   const sourceContents = [];
   if (Array.isArray(consumer.sourcesContent)) {
      consumer.sourcesContent.forEach((content, index) => {
         if (sources[index]) {
            sourceContents.push([sources[index], content]);
         }
      });
   }

   return {
      file,
      sourceRoot,
      mappings,
      sourceContents
   };
}

const moveMappingsSb = Symbol('moveMappings');

class SourceMapModifier {
   async initialize(sourceMapJson, sourceMapPaths) {
      const {
         file,
         sourceRoot,
         mappings,
         sourceContents
      } = await getSourceMapData(sourceMapJson);

      this._sourceMapJson = sourceMapJson;
      this._tasks = [];

      this._file = file;
      this._sourceRoot = sourceRoot;
      this._mappings = mappings;
      this._sourceContents = sourceContents;
      this._sourceMapPaths = sourceMapPaths;
   }

   get sourceMapJson() {
      return this._sourceMapJson;
   }

   get sourceMapComment() {
      return toComment(this._sourceMapJson);
   }

   process() {
      while (this._tasks.length > 0) {
         const task = this._tasks.shift();

         this[task.fn](task.cfg);
      }

      this._updateSourceMap();
   }

   moveMappings(startLocation, endLocation, lineShift, removeOutOfRange = true) {
      this._tasks.push({
         fn: moveMappingsSb,
         cfg: {
            startLocation,
            endLocation,
            lineShift,
            removeOutOfRange
         }
      });
   }

   [moveMappingsSb](cfg) {
      const {
         startLocation,
         endLocation,
         lineShift,
         removeOutOfRange
      } = cfg;

      const mappings = [];

      this._mappings.forEach((mapping) => {
         if (removeOutOfRange && !isInRange(mapping, startLocation, endLocation)) {
            return;
         }

         mappings.push({
            generatedLine: mapping.generatedLine + lineShift,
            generatedColumn: mapping.generatedColumn,
            originalLine: mapping.originalLine,
            originalColumn: mapping.originalColumn,
            source: mapping.source,
            name: mapping.name
         });
      });

      this._mappings = mappings;
   }

   _updateSourceMap() {
      const generator = new SourceMapGenerator({
         file: this._file,
         sourceRoot: this._sourceRoot
      });

      this._mappings.forEach((mapping) => {
         generator.addMapping({
            generated: {
               line: mapping.generatedLine,
               column: mapping.generatedColumn
            },
            original: {
               line: mapping.originalLine,
               column: mapping.originalColumn
            },
            source: mapping.source,
            name: mapping.name
         });
      });

      this._sourceContents.forEach(([source, content]) => {
         generator.setSourceContent(source, content);
      });

      this._sourceMapJson = generator.toJSON();
      this._sourceMapJson.file = this._sourceMapPaths.fileName;
      this._sourceMapJson.sourceRoot = this._sourceMapPaths.sourceRoot;
      this._sourceMapJson.sources = [this._sourceMapPaths.sourceFile];
   }
}

module.exports = SourceMapModifier;
