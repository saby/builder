/* eslint-disable no-unused-expressions */
'use strict';

const Analyzer = require('../lib/dependencies/analyzer');
const parse = require('../lib/dependencies/rjs');

const { expect } = require('chai');

describe('lib/dependencies', () => {
   describe('analyzer', () => {
      const analyzer = new Analyzer(null, [{ name: 'UIModule' }]);

      it('should normalize module', () => {
         const module = Analyzer.normalizeModule(parse('optional!is!browser?wml!Module/file'));

         expect(Array.from(module.plugins)).to.deep.equal([['wml', { arg: undefined, index: 2 }]]);
      });

      it('should normalize json module', () => {
         const module = Analyzer.normalizeModule(parse('Module/file.json'));

         expect(module.hasPlugin('json')).to.be.true;
         expect(module.name).to.equal('Module/file.json');
      });

      it('should normalize json module 2', () => {
         const module = Analyzer.normalizeModule(parse('json!Module/file'));

         expect(module.hasPlugin('json')).to.be.true;
         expect(module.name).to.equal('Module/file.json');
      });

      it('should include regular module dependency', () => {
         expect(analyzer.filterDependency(parse('UIModule/file'))).to.be.true;
         expect(analyzer.filterDependency(parse('js!UIModule/file'))).to.be.true;
      });

      it('should include json module dependency', () => {
         expect(analyzer.filterDependency(parse('UIModule/file.json'))).to.be.true;
         expect(analyzer.filterDependency(parse('json!UIModule/file'))).to.be.true;
      });

      it('should include template module dependency', () => {
         expect(analyzer.filterDependency(parse('wml!UIModule/file'))).to.be.true;
         expect(analyzer.filterDependency(parse('tmpl!UIModule/file'))).to.be.true;
         expect(analyzer.filterDependency(parse('html!UIModule/file'))).to.be.true;
      });

      it('should include optional module dependency', () => {
         expect(analyzer.filterDependency(parse('optional!UIModule/file'))).to.be.true;
      });

      it('should not include special module name', () => {
         expect(analyzer.filterDependency(parse('require'))).to.be.false;
         expect(analyzer.filterDependency(parse('exports'))).to.be.false;
         expect(analyzer.filterDependency(parse('module'))).to.be.false;
      });

      it('should not include optional module dependency', () => {
         expect(analyzer.filterDependency(parse('optional!UnknownModule/file'))).to.be.false;
      });

      it('should not include i18n module dependency', () => {
         expect(analyzer.filterDependency(parse('i18n!UIModule/file'))).to.be.false;
      });

      it('should not include cdn module dependency', () => {
         expect(analyzer.filterDependency(parse('cdn!UIModule/file'))).to.be.false;
         expect(analyzer.filterDependency(parse('/cdn/UIModule/file'))).to.be.false;
      });

      it('should not include npm package', () => {
         expect(analyzer.filterDependency(parse('jsdom'))).to.be.false;
      });

      it('should not include node.js module', () => {
         expect(analyzer.filterDependency(parse('path'))).to.be.false;
      });
   });

   describe('rjs', () => {
      it('should parse module with plugins', () => {
         const module = parse('optional!is!browser?Module/file');

         expect(module.hasPlugin('optional')).to.be.true;
         expect(module.hasPlugin('is')).to.be.true;
         expect(module.name).to.equal('Module/file');
      });
   });
});
