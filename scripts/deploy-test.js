// scripts/deploy-test.js
const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Deploying SpellBloc contracts for testing...");
    
    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log("📝 Deploying with account:", deployer.address);
    
    // Check balance
    const balance = await deployer.getBalance();
    console.log("💰 Account balance:", ethers.utils.formatEther(balance), "ETH");
    
    const deployedContracts = {};
    
    try {
        // 1. Deploy SpellBlocPayments
        console.log("\n🔄 Deploying SpellBlocPayments...");
        const SpellBlocPayments = await ethers.getContractFactory("SpellBlocPayments");
        const payments = await SpellBlocPayments.deploy();
        await payments.deployed();
        
        console.log("✅ SpellBlocPayments deployed to:", payments.address);
        deployedContracts.payments = payments.address;
        
        // 2. Deploy SpellBlocAchievements
        console.log("\n🔄 Deploying SpellBlocAchievements...");
        const SpellBlocAchievements = await ethers.getContractFactory("SpellBlocAchievements");
        const achievements = await SpellBlocAchievements.deploy();
        await achievements.deployed();
        
        console.log("✅ SpellBlocAchievements deployed to:", achievements.address);
        deployedContracts.achievements = achievements.address;
        
        // 3. Deploy SpellBlocLeaderboard
        console.log("\n🔄 Deploying SpellBlocLeaderboard...");
        const SpellBlocLeaderboard = await ethers.getContractFactory("SpellBlocLeaderboard");
        const leaderboard = await SpellBlocLeaderboard.deploy();
        await leaderboard.deployed();
        
        console.log("✅ SpellBlocLeaderboard deployed to:", leaderboard.address);
        deployedContracts.leaderboard = leaderboard.address;
        
        console.log("\n🎉 ALL CONTRACTS DEPLOYED SUCCESSFULLY!");
        console.log("📋 Contract Addresses:");
        console.log(`SpellBlocPayments:     ${deployedContracts.payments}`);
        console.log(`SpellBlocAchievements: ${deployedContracts.achievements}`);
        console.log(`SpellBlocLeaderboard:  ${deployedContracts.leaderboard}`);
        
        // Test basic functionality
        console.log("\n🧪 Testing basic functionality...");
        const monthlyPrice = await payments.planPrices(0);
        console.log("✅ Monthly subscription price:", ethers.utils.formatEther(monthlyPrice), "tokens");
        
        const totalAchievements = await achievements.totalAchievements();
        console.log("✅ Total achievement templates:", totalAchievements.toString());
        
        console.log("\n🔧 Environment Variables:");
        console.log(`NEXT_PUBLIC_PAYMENT_CONTRACT=${deployedContracts.payments}`);
        console.log(`NEXT_PUBLIC_ACHIEVEMENTS_CONTRACT=${deployedContracts.achievements}`);
        console.log(`NEXT_PUBLIC_LEADERBOARD_CONTRACT=${deployedContracts.leaderboard}`);
        
    } catch (error) {
        console.error("\n❌ DEPLOYMENT FAILED!");
        console.error("Error:", error.message);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Script execution failed:", error);
        process.exit(1);
    });