'use strict';

require('./init-test');
const { checkSourceNecessityByConfig } = require('../gulp/common/helpers');

describe('source-filter', () => {
   it('sources filter by gulp configuration', () => {
      const gulpConfig = {
         typescript: false,
         less: true,
         wml: false
      };
      let extension = '.ts';
      let result = checkSourceNecessityByConfig(gulpConfig, extension);
      result.should.equal(false);
      extension = '.less';
      result = checkSourceNecessityByConfig(gulpConfig, extension);
      result.should.equal(true);
      extension = '.wml';
      result = checkSourceNecessityByConfig(gulpConfig, extension);
      result.should.equal(false);
      extension = '.js';
      result = checkSourceNecessityByConfig(gulpConfig, extension);
      result.should.equal(true);
   });
});
