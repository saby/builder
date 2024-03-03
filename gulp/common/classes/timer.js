'use strict';

class Timer {
   constructor(taskName, timeReporter) {
      this.taskName = taskName;
      this.timeReporter = timeReporter;
   }

   start() {
      const self = this;

      return function startTaskTimer(done) {
         self.startTime = Date.now();
         self.timeReporter.setCurrentTask(self.taskName);

         done();
      };
   }

   lap(pluginName) {
      const self = this;

      return function lapTaskTimer(done) {
         self.timeReporter.storePluginTime(pluginName, self.startTime);
         self.timeReporter.storeTaskTime(self.taskName, self.startTime);

         self.startTime = Date.now();
         done();
      };
   }

   finish() {
      const self = this;

      return function finishTaskTimer(done) {
         self.timeReporter.storeTaskTime(self.taskName, self.startTime);
         self.timeReporter.normalizePluginsTime();

         done();
      };
   }
}

module.exports = Timer;
