/**
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');

const Analyzer = require('./dependencies/analyzer');
const { path } = require('./platform/path');

async function withTimer(stream, title, callback) {
   const startTime = Date.now();

   stream.write(`[TIMER] Started "${title}"\n`);

   try {
      const result = callback();

      if (result instanceof Promise) {
         await result;
      }
   } catch (error) {
      throw error;
   } finally {
      const duration = Math.ceil((Date.now() - startTime) / 1000);

      stream.write(`[TIMER] Finished "${title}" after ${duration} s.\n`);
   }
}

async function analyzeProjectDependencies(modules, externalModules, logFolder, outputPath) {
   let stream;

   try {
      stream = fs.createWriteStream(path.join(logFolder, 'deps-analysis.txt'), {
         encoding: 'utf-8'
      });

      const analyzer = new Analyzer(stream, modules, externalModules);

      await withTimer(stream, 'load', () => analyzer.load(outputPath));

      await withTimer(stream, 'writeJson', () => fs.writeJson(path.join(logFolder, 'deps-analysis.json'), analyzer, 'utf-8'));

      await withTimer(stream, 'testLostDependencies', () => analyzer.testLostDependencies(outputPath));

      await withTimer(stream, 'testCycles', () => analyzer.testCycles());

      await withTimer(stream, 'testUndeclaredUiDependencies', () => analyzer.testUndeclaredUiDependencies());

      await withTimer(stream, 'testUiCycles', () => analyzer.testUiCycles());

      return analyzer.diagnosticMessages;
   } catch (error) {
      if (stream) {
         stream.write(`[ERROR] ${error.message}\n${error.stack}\n`);
      }

      throw error;
   } finally {
      if (stream) {
         stream.close();
      }
   }
}

module.exports = analyzeProjectDependencies;
