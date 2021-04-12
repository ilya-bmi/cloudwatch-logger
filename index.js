/**
 * CLOUDWATCH LOGGER
 * =============
 */

const getCloudWatchLogs = require('./cloudwatch-logs.js');
const _logbuffer = new WeakMap()
const DeviceInfo = require("react-native-device-info");
let cloudwatchLog;
const delayFn = (fn, time) => makeQuerablePromise((new Promise((onSuccess) => setTimeout(() => onSuccess(), time))).then(() => fn()))
const makeQuerablePromise = promise => {
  // Don't modify any promise that has been already modified.
  if (promise.isResolved) return promise

  // Set initial state
  let isPending = true
  let isRejected = false
  let isFulfilled = false

  // Observe the promise, saving the fulfillment in a closure scope.
  let result = promise.then(
    v => {
      isFulfilled = true
      isPending = false
      return v
    },
    e => {
      isRejected = true
      isPending = false
      throw e
    }
  )

  result.isFulfilled = () => isFulfilled
  result.isPending = () => isPending
  result.isRejected = () => isRejected
  return result
}

class Logger {
  constructor(config) {
    const uniqueId = DeviceInfo.getUniqueId();
    const now = new Date();
    this.CloudWatchLogs = getCloudWatchLogs(config);
    this.logGroupName = config.logGroupName;
    this.logStreamName = config.customLogStreamName ? config.customLogStreamName : `${config.logStreamName}-${uniqueId}-${now.toISOString().replace(/:/g, "-")}`;
    this.sequenceToken = null;
    this.isConnected = false;
    this.uploadFreq = config?.uploadFreq || null;
  }

  // creates a new CloudWatch log stream asynchronously and returns `this`
  async connect() {

    const streamParams = {

      logStreamName: this.logStreamName,
      logGroupName: this.logGroupName
    };

    const responseHandler = (resolve, reject) => (err, data) => {
      if (err) {
        resolve(err);
      }
      else {
        resolve(this);
      }
    };

    return new Promise((resolve) => {
      this.CloudWatchLogs.createLogStream(streamParams, responseHandler(() => {
        this.isConnected = true;
        resolve();
      }, resolve));
    });
  }

  async log(...args) {
    if (!this.isConnected) await this.connect();
    if (!this.uploadFreq || this.uploadFreq < 0) {
      const logEvents = messages.map(m => {
        return {
          message: JSON.stringify(m),
          timestamp: Date.now()
        }
      });

      // console.log('Logging now...')
      // console.log(logs)
      this.sendLog(logEvents);

    }
    else {

      // 1. Accumulate all logs
      const now = Date.now()
      const logs = (args || []).map(x => ({ message: JSON.stringify(x), timestamp: now }))
      let latestBuffer = (_logbuffer.get(this) || { latest: now, data: [], job: null })
      latestBuffer.data = latestBuffer.data.concat(logs)

      // 2. If no job has ever been started, start it, or if the job is ready to process more
      if (!latestBuffer.job || !latestBuffer.job.isPending()) {
        latestBuffer.job = makeQuerablePromise(delayFn(() => {
          const { latest, data, job } = (_logbuffer.get(this) || { latest: now, data: [], job: null })
          // console.log('Finally logging now...')
          // console.log(data)
          _logbuffer.set(this, { latest, data: [], job })
          this.sendLog(data);

        }, this.uploadFreq))
      }
      //console.log('Buffering logs now...')
      // 3. In any case, memoize 
      _logbuffer.set(this, latestBuffer)
    }
  }



  // sends JSON-encoded arguments as individual log events to the CW log
  async sendLog(logEvents) {


    const streamParams = {
      logEvents,
      sequenceToken: this.sequenceToken,
      logStreamName: this.logStreamName,
      logGroupName: this.logGroupName
    };

    const responseHandler = (resolve, reject) => (err, data) => {
      if (err) {
        reject(err);
      } else {
        this.sequenceToken = data.nextSequenceToken;
        resolve(data);
      }
    };

    return new Promise((resolve, reject) => {
      this.CloudWatchLogs.putLogEvents(streamParams, responseHandler(resolve, reject));
    });
  }

  getAWSObject() {
    return this.CloudWatchLogs;
  }
};
const getLoger = () => {
  return cloudwatchLog

}
const initLogger = (config) => {
  cloudwatchLog = new Logger(config);
  return cloudwatchLog;
}
module.exports = { getLoger, initLogger }
