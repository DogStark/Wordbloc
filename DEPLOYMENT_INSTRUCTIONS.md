# 🚢 SpellBloc Celo Deployment Instructions

## 📋 Prerequisites

### 1. Install Dependencies
```bash
# Install Node.js dependencies
npm install

# Install Hardhat and OpenZeppelin contracts
npm install --save-dev @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
```

### 2. Setup Environment
```bash
# Copy environment template
cp .env.example .env

# Edit .env file with your values:
# - PRIVATE_KEY: Your Celo wallet private key
# - CELOSCAN_API_KEY: API key from Celoscan (optional)
```

### 3. Fund Your Wallet
- Get CELO tokens for gas fees
- Minimum 0.1 CELO recommended for deployment
- Use Celo faucet for testnet: https://faucet.celo.org

## 🚀 Deployment Steps

### Step 1: Compile Contracts
```bash
npx hardhat compile
```

### Step 2: Deploy to Celo Mainnet
```bash
npx hardhat run scripts/deploy-celo-mainnet.js --network celo
```

### Step 3: Verify Contracts (Optional)
```bash
# Verify SpellBlocPayments
npx hardhat verify --network celo <PAYMENTS_CONTRACT_ADDRESS>

# Verify SpellBlocAchievements  
npx hardhat verify --network celo <ACHIEVEMENTS_CONTRACT_ADDRESS>

# Verify SpellBlocLeaderboard
npx hardhat verify --network celo <LEADERBOARD_CONTRACT_ADDRESS>
```

### Step 4: Update Frontend
```bash
# Copy generated environment variables to your frontend
cp .env.production .env.local

# Update contract addresses in your app
```

## 🔧 Testing Deployment

### Test on Alfajores Testnet First
```bash
# Deploy to testnet
npx hardhat run scripts/deploy-celo-mainnet.js --network alfajores

# Test MiniPay integration
# Test subscription purchases
# Test NFT minting
```

### Verify Functionality
1. **MiniPay Connection**: Test wallet connection
2. **Subscription Purchase**: Buy premium plan with cUSD
3. **Achievement Minting**: Mint NFT badges
4. **Leaderboard Updates**: Update player rankings

## 📊 Contract Addresses (After Deployment)

```
SpellBlocPayments:     0x[DEPLOYED_ADDRESS]
SpellBlocAchievements: 0x[DEPLOYED_ADDRESS]  
SpellBlocLeaderboard:  0x[DEPLOYED_ADDRESS]
```

## 🎯 Celo Proof of Ship Submission

### Required Information
- **Project Title**: SpellBloc: AI-Powered Spelling Education with Blockchain Verification
- **MiniPay Integration**: ✅ Subscription payments via cUSD
- **Celo Deployment**: ✅ Smart contracts on mainnet
- **Humanity Verification**: ✅ Coinbase verification
- **Demo URL**: https://spellbloc-demo.vercel.app

### Submission Checklist
- [ ] MiniPay hook implemented and tested
- [ ] Smart contracts deployed on Celo mainnet
- [ ] Humanity verification completed
- [ ] Demo video recorded (2-3 minutes)
- [ ] GitHub repository public and documented
- [ ] Live demo deployed and accessible

## 🔍 Troubleshooting

### Common Issues

#### Gas Estimation Failed
```bash
# Increase gas limit in hardhat.config.js
gas: 10000000
```

#### Insufficient Funds
```bash
# Check wallet balance
npx hardhat run scripts/check-balance.js --network celo
```

#### Contract Verification Failed
```bash
# Wait 1-2 minutes after deployment
# Ensure contract is fully deployed before verification
```

### Debug Commands
```bash
# Check network connection
npx hardhat run scripts/test-connection.js --network celo

# Verify contract deployment
npx hardhat run scripts/verify-deployment.js --network celo
```

## 📞 Support

### Resources
- **Celo Documentation**: https://docs.celo.org
- **MiniPay SDK**: https://docs.celo.org/developer/minipay
- **Hardhat Docs**: https://hardhat.org/docs
- **OpenZeppelin**: https://docs.openzeppelin.com

### Community
- **Celo Discord**: https://discord.gg/celo
- **Celo Forum**: https://forum.celo.org
- **GitHub Issues**: Create issue in repository

---

## 🎉 Success!

Once deployed, your SpellBloc contracts will be live on Celo mainnet, ready for MiniPay integration and Proof of Ship submission!

**Next Steps:**
1. Test all functionality thoroughly
2. Submit to Celo Proof of Ship
3. Share with the community
4. Continue building awesome features!

🚢 **Ready to ship!** 🎮