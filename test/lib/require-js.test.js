/* eslint-disable no-unused-expressions */
'use strict';

const { expect } = require('chai');
const RJsModuleName = require('../../lib/require-js');

describe('lib/require-js', () => {
   it('should process module name', () => {
      const rawValue = 'Module/file';

      const moduleName = RJsModuleName.from(rawValue);
      expect(moduleName.raw).equals(rawValue);
      expect(moduleName.name).equals(rawValue);
   });
   it('should process with simple plugin', () => {
      const name = 'Module/file';
      const rawValue = `wml!${name}`;

      const moduleName = RJsModuleName.from(rawValue);
      expect(moduleName.raw).equals(rawValue);
      expect(moduleName.name).equals(name);
      expect(moduleName.hasPlugin('wml')).to.be.true;
   });
   it('should process with complex plugin', () => {
      const name = 'Module/file';
      const rawValue = `is!~browser?wml!${name}`;

      const moduleName = RJsModuleName.from(rawValue);
      expect(moduleName.raw).equals(rawValue);
      expect(moduleName.name).equals(name);
      expect(moduleName.hasPlugin('is')).to.be.true;
      expect(moduleName.hasPlugin('wml')).to.be.true;
   });
   it('should use substitution', () => {
      const name = 'WS.Core/transport/file';
      const rawValue = `is!~browser?wml!${name}`;

      const moduleName = RJsModuleName.from(rawValue);
      expect(moduleName.raw).equals('is!~browser?wml!Transport/file');
      expect(moduleName.name).equals('Transport/file');
      expect(moduleName.hasPlugin('is')).to.be.true;
      expect(moduleName.hasPlugin('wml')).to.be.true;
   });
});
