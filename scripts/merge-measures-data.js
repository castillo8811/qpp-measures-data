// this script merges the tmp/quality-performance-rates.json,
// measures/quality-measures-additional-info.json, and the measures from stdin
// into a new file that has more info about each performance strata
var _     = require('lodash');
var fs    = require('fs');
var path  = require('path');
var qpp = '';

process.stdin.setEncoding('utf8');

process.stdin.on('readable', () => {
  var chunk = process.stdin.read();
  if (chunk !== null) {
    qpp += chunk;
  }
});

process.stdin.on('end', () => {
  process.stdout.write(mergeQpp(JSON.parse(qpp, 'utf8')));
});

function mergeQpp(qppJson) {
  // read in tmp/quality-performance-rates.json
  var performanceRatesJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../util/quality-performance-rates.json'), 'utf8'));
  // read in measures/quality-measures-additional-info.json
  var performanceRateAdditionalJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../util/quality-measures-strata-details.json'), 'utf8'));

  var measuresNotFound = [];
  // iterate through all qppJson measures and find matching items from other json blobs
  qppJson.forEach(function(qppItem, index) {
    if (qppItem.category === 'quality') {
      var performanceRateDescription = _.find(performanceRatesJson, {'qualityId': qppItem.measureId});
      var performanceRateInfo = _.find(performanceRateAdditionalJson, {'qualityId': qppItem.measureId});

      if (!performanceRateDescription || !performanceRateInfo) {
        return measuresNotFound.push(qppItem.measureId);
      }

      var strataDetails = [];
      performanceRateDescription.descriptions.forEach(function(description, index) {
        strataDetails.push({description: description, name: performanceRateInfo.performanceRates[index]});
      });

      qppJson[index].strata = strataDetails;
      qppJson[index].overallAlgorithm = performanceRateInfo.overallAlgorithm;

      if (performanceRateInfo.metricType) {
        qppJson[index].metricType = performanceRateInfo.metricType;
      }

    }
  });

  // Almost all eCQM measure and strata UUIDs as well as strata descriptions can be extracted from source XML files (with two exceptions which are handled below).
  // scripts/get-strata-and-uuids-from-ecqm-zip.js produces the generated-ecqm-data.json file which is integrated into measures-data below.
  const generatedEcqmStrataJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../util/generated-ecqm-data.json'), 'utf8'));

  qppJson.forEach(function(qppItem, index) {
    if (qppItem.category !== 'quality') return;
    const ecqmInfo = _.find(generatedEcqmStrataJson, {'eMeasureId': qppItem.eMeasureId});
    if (!ecqmInfo) return;

    qppJson[index].eMeasureUuid = ecqmInfo.eMeasureUuid;
    qppJson[index].metricType = ecqmInfo.metricType;
    const oldStrata = qppJson[index].strata;

    // if none, just set it
    if (oldStrata.length === 0) {
      qppJson[index].strata = ecqmInfo.strata;
    } else { // only override description, uuids
      ecqmInfo.strata.forEach((newStratum, ecqmIndex) => {
        if (oldStrata[ecqmIndex]) {
          qppJson[index].strata[ecqmIndex].eMeasureUuids = newStratum.eMeasureUuids;
          qppJson[index].strata[ecqmIndex].description = newStratum.description;
        } else {
          qppJson[index].strata[ecqmIndex] = newStratum;
        }
      });
      if (oldStrata.length > 1) {
        // ASSUMPTION: strata already available are in the same order as the ones extracted from the xml files
        // @kencheeto: CMS156v5 is the only one that has more than one stratum and the ordering is correct
        console.warn(qppItem.eMeasureId, ': we are not guaranteed the same ordering, please double check these strata values in the diff');
      }
    }
  });

  // There are two measures (CMS145v5 and CMS160v5) whose source XML files from the zip mentioned above don't have a programmatically parseable format for UUID/description extraction. Also, strata names for almost all eCQM measures need to be manually created.
  // scripts/find-ecqms-with-missing-data.js produces the manually-added-ecqm-data.json file, which has been manually edited with the correct strata names and hardcoded info for 145v5 and 160v5.
  const manuallyAddedEcqmStrataJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../util/manually-added-ecqm-data.json'), 'utf8'));

  qppJson.forEach(function(qppItem, index) {
    if (qppItem.category !== 'quality') return;
    const ecqmInfo = _.find(manuallyAddedEcqmStrataJson, {'eMeasureId': qppItem.eMeasureId});
    if (!ecqmInfo) return;

    if (ecqmInfo.overallAlgorithm) {
      qppJson[index].overallAlgorithm = ecqmInfo.overallAlgorithm;
    }

    if (ecqmInfo.metricType) {
      qppJson[index].metricType = ecqmInfo.metricType;
    }

    if (['CMS145v5', 'CMS160v5'].includes(qppItem.eMeasureId)) {
      qppJson[index].strata = ecqmInfo.strata;
      qppJson[index].eMeasureUuid = ecqmInfo.eMeasureUuid;
    } else {
      // strata length in both files should match now
      ecqmInfo.strata.forEach((newStratum, ecqmIndex) => {
        qppJson[index].strata[ecqmIndex].name = newStratum.name;
      });
    }
  });

  console.error('did not find measure details for the following', measuresNotFound);

  return JSON.stringify(qppJson, null, 2);
}
