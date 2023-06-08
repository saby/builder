'use strict';

const garbageDeclarations = require('../../lib/less/fallback');
const { path, toPosix } = require('../../lib/platform/path');
const { expect } = require('chai');

const dirname = toPosix(__dirname);

describe('lib/less/fallback', () => {
   it('should process value parens', () => {
      const storage = { };
      const file = {
         path: path.join(dirname, 'resources', 'simple.less'),
         dirname: path.join(dirname, 'resources'),
         base: 'simple'
      };
      const moduleInfo = {
         name: 'Module',
         path: path.join(dirname, 'resources', 'Module'),
         appRoot: path.join(dirname, 'resources')
      };

      garbageDeclarations(file, storage, moduleInfo);

      expect(storage).deep.equal({
         '--offset-button': 'var(--offset)',
         '--border-radius': '50%',
         '--background-color': '#ebedf0',
         '--box-shadow': '0 1px 5px 0 rgba(0, 0, 0, 0.12)',
         '--min-width_button_button': 'calc(((var(--height) / 2) + var(--padding) * 2) / 3)'
      });
   });
});
