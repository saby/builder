'use strict';

require('./init-test');

const promiseTimeout = require('../lib/promise-with-timeout');

describe('promise with timeout', () => {
   it('should return timeout error if Timeout', async() => {
      let result;
      try {
         result = await promiseTimeout.promiseWithTimeout(new Promise(resolve => setTimeout(resolve, 100)), 10);
      } catch (err) {
         result = err instanceof promiseTimeout.TimeoutError;
      }
      result.should.equal(true);
   });

   it('should return result if resolved successfully', async() => {
      let result;
      const testResult = 'some value';
      try {
         result = await promiseTimeout.promiseWithTimeout(
            new Promise(resolve => setTimeout(() => resolve(testResult), 10)),
            100
         );
      } catch (err) {
         result = err;
      }
      result.should.equal(testResult);
   });

   it('should return correct exception if promise rejected with Error', async() => {
      let result;
      const testError = new Error('some Error rejected');
      try {
         result = await promiseTimeout.promiseWithTimeout(
            new Promise((resolve, reject) => setTimeout(() => reject(testError), 10)),
            100
         );
      } catch (err) {
         result = err;
      }

      // результат должен быть ошибкой, но не по таймауту
      (!(result instanceof promiseTimeout.TimeoutError) && result instanceof Error).should.equal(true);
      result.message.should.equal('some Error rejected');
   });
});
