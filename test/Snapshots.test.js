const {time, BN} = require('@openzeppelin/test-helpers');
const {accounts, contract} = require('@openzeppelin/test-environment');
const chai = require('chai');

const {toBN} = require('./utils/BNUtils.js');
const {toCVI} = require('./utils/BNUtils.js');
const {deployFullPlatform, getContracts} = require('./utils/DeployUtils.js');
const {calculateSingleUnitFee, calculateNextAverageTurbulence} = require('./utils/FeesUtils.js');

const expect = chai.expect;
const [admin] = accounts;

const PRECISION_DECIMALS = toBN(1, 10);
const HEART_BEAT_SECONDS = 55 * 60;

let firstSnapshot;
let latestSnapshotUpdateTime;
const updateSnapshots = async () => {
    if (this.isETH) {
        await this.platform.depositETH(new BN(0), {value: new BN(1), from: admin});
    } else {
        await this.platform.deposit(new BN(1), new BN(0), {from: admin});
    }

    if(!firstSnapshot) {
        const firstSnapshotTime = await time.latest();
        firstSnapshot = await this.platform.cviSnapshots(firstSnapshotTime);
    }

    latestSnapshotUpdateTime = await time.latest();
};

const validateTurbulence = async (roundPeriods, lastPeriod) => {
    await updateSnapshots();
    const startTime = await time.latest();
    const turbulence = await this.feesCalculator.turbulenceIndicatorPercent();

    let currCVI = 6000;
    const lastCVI = 6000;
    let latestCVI = currCVI;
    for (let period of roundPeriods) {
        await time.increase(period);
        await this.fakePriceProvider.setPrice(toCVI(currCVI));
        latestCVI = currCVI;

        currCVI += 1000;
    }

    if (lastPeriod !== 0) {
        await time.increase(lastPeriod);
    }

    await updateSnapshots();
    const updatedTurbulence = await this.feesCalculator.turbulenceIndicatorPercent();

    const timeDiff = (await time.latest()).sub(startTime);
    expect(updatedTurbulence).to.be.bignumber.equal(calculateNextAverageTurbulence(turbulence, timeDiff, HEART_BEAT_SECONDS, roundPeriods.length, new BN(lastCVI), new BN(latestCVI)));
};

const increaseTurbulence = async increases => {
    const roundPeriods = [];
    for (let i = 0; i < increases; i++) {
        roundPeriods.push(1 * 60);
    }

    await validateTurbulence(roundPeriods, 0);
};

const getLatestSnapshot = async () => {
    const snapshot = await this.platform.cviSnapshots(latestSnapshotUpdateTime);
    return snapshot;
};

const beforeEachSnapshots = async isETH => {
    await deployFullPlatform(isETH);

    this.isETH = isETH;
    this.token = getContracts().token;
    this.fakePriceProvider = getContracts().fakePriceProvider;
    this.fakeOracle =getContracts().fakeOracle;
    this.feesCalculator = getContracts().feesCalculator;
    this.fakeFeesCollector = getContracts().fakeFeesCollector;
    this.liquidation = getContracts().liquidation;
    this.platform = getContracts().platform;

    if (!this.isETH) {
        await this.token.approve(this.platform.address, new BN(1000), {from: admin});
    }
};

const setSnapshotTests = () => {
    it('sets first snapshot to precision decimals', async () => {
        await updateSnapshots();
        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS);
    });

    it('calculates correct snapshot when no new oracle round exists', async () => {
        await this.fakePriceProvider.setPrice(toCVI(5000));
        await updateSnapshots();
        const startTime = await time.latest();
        await time.increase(60 * 60);
        await updateSnapshots();
        const endTime = await time.latest();

        const singleUnitFee = calculateSingleUnitFee(5000, endTime.sub(startTime).toNumber());

        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS.add(singleUnitFee));
    });

    it('calculates correct snapshot between oracle time and timestamp is identical to latest oracle round', async () => {
        await this.fakePriceProvider.setPrice(toCVI(5000));
        await updateSnapshots();
        const startTime = await time.latest();
        await time.increase(60 * 60);
        await this.fakePriceProvider.setPrice(toCVI(6000));
        await updateSnapshots();
        const endTime = await time.latest();

        const singleUnitFee = calculateSingleUnitFee(5000, endTime.sub(startTime).toNumber());

        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS.add(singleUnitFee));
    });

    it('calculates correct snapshot between oracle time and timestamp is after latest oracle round', async () => {
        await this.fakePriceProvider.setPrice(toCVI(5000));
        await updateSnapshots();
        const startTime = await time.latest();
        await time.increase(60 * 60);
        await this.fakePriceProvider.setPrice(toCVI(6000));
        const endTime1 = await time.latest();
        await time.increase(2 * 60 * 60);
        await updateSnapshots();
        const endTime2 = await time.latest();

        const singleUnitFee = calculateSingleUnitFee(5000, endTime1.sub(startTime).toNumber());
        const singleUnitFee2 = calculateSingleUnitFee(6000, endTime2.sub(endTime1).toNumber());

        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS.add(singleUnitFee.add(singleUnitFee2)));
    });

    it('calculates correct snapshot between non-oracle time and timestamp identical to latest oracle round', async () => {
        await this.fakePriceProvider.setPrice(toCVI(5000));
        await time.increase(3 * 60 * 60);
        await updateSnapshots();
        const startTime = await time.latest();
        await time.increase(3 * 60 * 60);
        await this.fakePriceProvider.setPrice(toCVI(6000));
        const middleTime = await time.latest();
        await updateSnapshots();
        const endTime = await time.latest();

        const singleUnitFee = calculateSingleUnitFee(5000, middleTime.sub(startTime).toNumber());
        const singleUnitFee2 = calculateSingleUnitFee(6000, endTime.sub(middleTime).toNumber());

        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS.add(singleUnitFee.add(singleUnitFee2)));
    });

    it('calculates correct snapshot between non-oracle time and timestamp is after latest oracle round', async () => {
        await this.fakePriceProvider.setPrice(toCVI(5000));
        await time.increase(3 * 60 * 60);
        await updateSnapshots();
        const startTime = await time.latest();
        await time.increase(3 * 60 * 60);
        await this.fakePriceProvider.setPrice(toCVI(6000));
        const middleTime = await time.latest();
        await time.increase(2 * 60 * 60);
        await updateSnapshots();
        const endTime = await time.latest();

        const singleUnitFee = calculateSingleUnitFee(5000, middleTime.sub(startTime).toNumber());
        const singleUnitFee2 = calculateSingleUnitFee(6000, endTime.sub(middleTime).toNumber());

        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS.add(singleUnitFee.add(singleUnitFee2)));
    });

    it('disregards middle oracle rounds when calculating next snapshot', async () => {
        await this.fakePriceProvider.setPrice(toCVI(5000));
        await time.increase(3 * 60 * 60);
        await updateSnapshots();
        const startTime = await time.latest();
        await this.fakePriceProvider.setPrice(toCVI(7000));
        await time.increase(2 * 60 * 60);
        await this.fakePriceProvider.setPrice(toCVI(8000));
        await time.increase(3 * 60 * 60);
        await this.fakePriceProvider.setPrice(toCVI(6000));
        const middleTime = await time.latest();
        await time.increase(2 * 60 * 60);
        await updateSnapshots();
        const endTime = await time.latest();

        const singleUnitFee = calculateSingleUnitFee(5000, middleTime.sub(startTime).toNumber());
        const singleUnitFee2 = calculateSingleUnitFee(6000, endTime.sub(middleTime).toNumber());

        expect(await getLatestSnapshot()).to.be.bignumber.equal(PRECISION_DECIMALS.add(singleUnitFee.add(singleUnitFee2)));
    });

    it('keeps turbuelence at zero when decaying', async () => {
        await validateTurbulence([60 * 60, 30 * 60, 3 * 60 * 60], 15 * 60);
    });

    it('updates turbulence properly when more hours passed than new rounds', async () => {
        await increaseTurbulence(10);
        await validateTurbulence([60 * 60, 30 * 60, 3 * 60 * 60], 15 * 60);
    });

    it('updates turbulence properly when new rounds are the same as hours passed', async () => {
        await increaseTurbulence(10);
        await validateTurbulence([60 * 60, 30 * 60, 120 * 60]);
    });

    it('updates turbulence properly when hours passed are less than new rounds', async () => {
        await increaseTurbulence(5);
        await validateTurbulence([60 * 60, 30 * 60, 30 * 60]);
    });

    it('caps turbulence to maximum proeprly', async () => {
        await increaseTurbulence(11);
    });

    it('zeroes turbulence if decays below minimum', async () => {
        await increaseTurbulence(3);
        await validateTurbulence([60 * 60, 60 * 60, 60 * 60]);
    });

    it('moves turbulences to end of time span', async () => {
        await increaseTurbulence(3);
        await validateTurbulence([10 * 60, 10 * 60, 10 * 60, 60 * 60]);
    });

    it.skip('skips updating same block', async () => {
    });

    it.skip('calculates latest funding fee properly', async () => {

    });

    it.skip('calculates funding fee without end time properly', async () => {

    });

    it.skip('calculates funding fee with end time properly', async () => {

    });

    it.skip('reverts when oracle round id is smaller than latest round id', async () => {
        //const feeModel = await FeesModelV2.new(10, 1, 0, ZERO_ADDRESS, this.feesCalculator.address, this.fakeOracle.address, {from: admin});
        //await expectRevert(feeModel.updateSnapshots(), 'Bad round id');
    });

    it.skip('calculateFundingFeesAddendum related tests', async () =>{
        await time.increase(3600);
        let cviValue = toCVI(5000);
        await this.fakePriceProvider.setPrice(cviValue);

        await this.feeModel.updateSnapshots({from: admin}); // Restarts count

        await time.increase(3600);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('20833332');

        await time.increase(3600);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('41666666');

        await time.increase(3600);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('62500000');

        await this.feeModel.updateSnapshots({from: admin}); // Restarts count

        await time.increase(3600 * 3);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('62500000');

        await this.feeModel.updateSnapshots({from: admin}); // Restarts count

        await time.increase(3600);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('20833332');
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('20833332');

        cviValue = toCVI(5000);
        await this.fakePriceProvider.setPrice(cviValue);
        await time.increase(1800);

        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(2,10), {from: admin})).to.be.bignumber.equal('31249998');
    });

    it.skip('calculateFundingFeesAddendum related tests with price change', async () =>{
        await time.increase(100);
        let cviValue = toCVI(4000);
        await this.fakePriceProvider.setPrice(cviValue);
        await this.feeModel.updateSnapshots({from: admin}); // Restarts count

        await time.increase(360);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(1,10), {from: admin})).to.be.bignumber.equal('833333');
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(1,10), {from: admin})).to.be.bignumber.equal('833333');

        cviValue = toCVI(12500);
        await this.fakePriceProvider.setPrice(cviValue);

        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(1,10), {from: admin})).to.be.bignumber.equal('833333');

        await time.increase(360);
        expect(await this.feeModel.calculateFundingFeesAddendum(toBN(1,10), {from: admin})).to.be.bignumber.equal('885416');
    });
};


describe('Snapshots ETH', () => {
    beforeEach(async () => {
        await beforeEachSnapshots(true);
    });

    setSnapshotTests(true);
});

describe('Snapshots', () => {
    beforeEach(async () => {
        await beforeEachSnapshots(false);
    });

    setSnapshotTests(false);
});
