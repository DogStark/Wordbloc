// scripts/deploy-celo-mainnet.js
const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🚀 Deploying SpellBloc contracts to Celo Mainnet...");
    console.log("⏰ Timestamp:", new Date().toISOString());
    
    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("📝 Deploying with account:", deployer.address);
    
    // Check balance
    const balance = await deployer.getBalance();
    console.log("💰 Account balance:", ethers.utils.formatEther(balance), "CELO");
    
    if (balance.lt(ethers.utils.parseEther("0.1"))) {
        console.warn("⚠️  Low balance! Make sure you have enough CELO for gas fees.");
    }
    
    console.log("\n" + "=".repeat(50));
    console.log("📋 DEPLOYMENT PLAN");
    console.log("=".repeat(50));
    console.log("1. SpellBlocPayments - Subscription & payment handling");
    console.log("2. SpellBlocAchievements - NFT achievement system");
    console.log("3. SpellBlocLeaderboard - Transparent rankings");
    console.log("=".repeat(50) + "\n");
    
    const deployedContracts = {};
    
    try {
        // 1. Deploy SpellBlocPayments
        console.log("🔄 Deploying SpellBlocPayments...");
        const SpellBlocPayments = await ethers.getContractFactory("SpellBlocPayments");
        const payments = await SpellBlocPayments.deploy();
        await payments.deployed();
        
        console.log("✅ SpellBlocPayments deployed!");
        console.log("   📍 Address:", payments.address);
        console.log("   🧾 Transaction:", payments.deployTransaction.hash);
        
        deployedContracts.payments = {
            address: payments.address,
            txHash: payments.deployTransaction.hash
        };
        
        // Verify deployment
        const paymentsCode = await ethers.provider.getCode(payments.address);
        if (paymentsCode === "0x") {
            throw new Error("SpellBlocPayments deployment failed - no code at address");
        }
        
        // 2. Deploy SpellBlocAchievements
        console.log("\n🔄 Deploying SpellBlocAchievements...");
        const SpellBlocAchievements = await ethers.getContractFactory("SpellBlocAchievements");
        const achievements = await SpellBlocAchievements.deploy();
        await achievements.deployed();
        
        console.log("✅ SpellBlocAchievements deployed!");
        console.log("   📍 Address:", achievements.address);
        console.log("   🧾 Transaction:", achievements.deployTransaction.hash);
        
        deployedContracts.achievements = {
            address: achievements.address,
            txHash: achievements.deployTransaction.hash
        };
        
        // Verify deployment
        const achievementsCode = await ethers.provider.getCode(achievements.address);
        if (achievementsCode === "0x") {
            throw new Error("SpellBlocAchievements deployment failed - no code at address");
        }
        
        // 3. Deploy SpellBlocLeaderboard
        console.log("\n🔄 Deploying SpellBlocLeaderboard...");
        const SpellBlocLeaderboard = await ethers.getContractFactory("SpellBlocLeaderboard");
        const leaderboard = await SpellBlocLeaderboard.deploy();
        await leaderboard.deployed();
        
        console.log("✅ SpellBlocLeaderboard deployed!");
        console.log("   📍 Address:", leaderboard.address);
        console.log("   🧾 Transaction:", leaderboard.deployTransaction.hash);
        
        deployedContracts.leaderboard = {
            address: leaderboard.address,
            txHash: leaderboard.deployTransaction.hash
        };
        
        // Verify deployment
        const leaderboardCode = await ethers.provider.getCode(leaderboard.address);
        if (leaderboardCode === "0x") {
            throw new Error("SpellBlocLeaderboard deployment failed - no code at address");
        }
        
        console.log("\n" + "=".repeat(50));
        console.log("🎉 ALL CONTRACTS DEPLOYED SUCCESSFULLY!");
        console.log("=".repeat(50));
        
        // Display summary
        console.log("\n📋 DEPLOYMENT SUMMARY");
        console.log("-".repeat(30));
        console.log(`SpellBlocPayments:     ${deployedContracts.payments.address}`);
        console.log(`SpellBlocAchievements: ${deployedContracts.achievements.address}`);
        console.log(`SpellBlocLeaderboard:  ${deployedContracts.leaderboard.address}`);
        console.log("-".repeat(30));
        
        // Test basic functionality
        console.log("\n🧪 Testing basic functionality...");
        
        // Test payments contract
        const monthlyPrice = await payments.planPrices(0); // MONTHLY = 0
        console.log("✅ Monthly subscription price:", ethers.utils.formatEther(monthlyPrice), "cUSD");
        
        // Test achievements contract
        const totalAchievements = await achievements.totalAchievements();
        console.log("✅ Total achievement templates:", totalAchievements.toString());
        
        // Test leaderboard contract
        const leaderboardName = await leaderboard.name();
        console.log("✅ Leaderboard name:", leaderboardName);
        
        // Save deployment info
        const deploymentInfo = {
            network: "celo-mainnet",
            timestamp: new Date().toISOString(),
            deployer: deployer.address,
            contracts: deployedContracts,
            gasUsed: {
                payments: payments.deployTransaction.gasLimit?.toString() || "N/A",
                achievements: achievements.deployTransaction.gasLimit?.toString() || "N/A",
                leaderboard: leaderboard.deployTransaction.gasLimit?.toString() || "N/A"
            }
        };
        
        // Write deployment info to file
        const deploymentPath = path.join(__dirname, '..', 'deployments', 'celo-mainnet.json');
        const deploymentDir = path.dirname(deploymentPath);
        
        if (!fs.existsSync(deploymentDir)) {
            fs.mkdirSync(deploymentDir, { recursive: true });
        }
        
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        console.log("💾 Deployment info saved to:", deploymentPath);
        
        // Generate environment variables
        console.log("\n🔧 Environment Variables for Frontend:");
        console.log("-".repeat(40));
        console.log(`NEXT_PUBLIC_PAYMENT_CONTRACT=${deployedContracts.payments.address}`);
        console.log(`NEXT_PUBLIC_ACHIEVEMENTS_CONTRACT=${deployedContracts.achievements.address}`);
        console.log(`NEXT_PUBLIC_LEADERBOARD_CONTRACT=${deployedContracts.leaderboard.address}`);
        console.log(`NEXT_PUBLIC_CELO_NETWORK=mainnet`);
        console.log("-".repeat(40));
        
        // Generate .env file
        const envContent = `# SpellBloc Celo Mainnet Contract Addresses
# Generated on ${new Date().toISOString()}

NEXT_PUBLIC_PAYMENT_CONTRACT=${deployedContracts.payments.address}
NEXT_PUBLIC_ACHIEVEMENTS_CONTRACT=${deployedContracts.achievements.address}
NEXT_PUBLIC_LEADERBOARD_CONTRACT=${deployedContracts.leaderboard.address}
NEXT_PUBLIC_CELO_NETWORK=mainnet

# Celo Mainnet Configuration
NEXT_PUBLIC_CELO_RPC_URL=https://forno.celo.org
NEXT_PUBLIC_CELO_CHAIN_ID=42220
NEXT_PUBLIC_CUSD_TOKEN_ADDRESS=0x765DE816845861e75A25fCA122bb6898B8B1282a

# MiniPay Integration
NEXT_PUBLIC_MINIPAY_ENABLED=true
`;
        
        const envPath = path.join(__dirname, '..', '.env.production');
        fs.writeFileSync(envPath, envContent);
        console.log("💾 Environment file saved to:", envPath);
        
        // Verification instructions
        console.log("\n🔍 VERIFICATION INSTRUCTIONS");
        console.log("-".repeat(30));
        console.log("To verify contracts on Celoscan, run:");
        console.log(`npx hardhat verify --network celo ${deployedContracts.payments.address}`);
        console.log(`npx hardhat verify --network celo ${deployedContracts.achievements.address}`);
        console.log(`npx hardhat verify --network celo ${deployedContracts.leaderboard.address}`);
        
        // Next steps
        console.log("\n📋 NEXT STEPS");
        console.log("-".repeat(15));
        console.log("1. ✅ Update frontend environment variables");
        console.log("2. ✅ Test MiniPay integration");
        console.log("3. ✅ Verify contracts on Celoscan");
        console.log("4. ✅ Submit to Celo Proof of Ship");
        console.log("5. ✅ Announce deployment to community");
        
        console.log("\n🚢 Ready for Celo Proof of Ship submission! 🎉");
        
    } catch (error) {
        console.error("\n❌ DEPLOYMENT FAILED!");
        console.error("Error:", error.message);
        
        if (error.transaction) {
            console.error("Transaction hash:", error.transaction.hash);
        }
        
        if (error.receipt) {
            console.error("Gas used:", error.receipt.gasUsed?.toString());
        }
        
        // Save error info
        const errorInfo = {
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack,
            deployedContracts
        };
        
        const errorPath = path.join(__dirname, '..', 'deployments', 'error.json');
        fs.writeFileSync(errorPath, JSON.stringify(errorInfo, null, 2));
        console.error("💾 Error info saved to:", errorPath);
        
        process.exit(1);
    }
}

// Handle script execution
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error("❌ Script execution failed:", error);
            process.exit(1);
        });
}

module.exports = main;