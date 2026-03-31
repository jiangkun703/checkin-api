// 签到API - 微信群签到功能（Vercel Redis KV存储版）
// 使用 Vercel KV (Redis) 作为数据库

// 获取今天的日期字符串（北京时间）
function getTodayDate() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  return beijingTime.toISOString().split('T')[0];
}

// 获取昨天的日期字符串
function getYesterdayDate() {
  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  beijingTime.setDate(beijingTime.getDate() - 1);
  return beijingTime.toISOString().split('T')[0];
}

// Vercel Serverless Function 主入口
module.exports = async (req, res) => {
  // 设置CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    const { msg, userId, userName, groupId, action } = req.query;
    
    // 检查环境变量
    if (!process.env.REDIS_URL) {
      console.error('REDIS_URL 环境变量未设置');
      return res.status(500).send('❌ 数据库配置错误：REDIS_URL 未设置');
    }
    
    // 导入 Redis 客户端（延迟导入，避免构建错误）
    let createClient;
    try {
      const redisModule = require('redis');
      createClient = redisModule.createClient;
    } catch (err) {
      console.error('Redis 模块未安装:', err);
      return res.status(500).send('❌ 数据库依赖未安装');
    }
    
    console.log('开始连接 Redis...');
    console.log('REDIS_URL:', process.env.REDIS_URL);
    
    let client;
    try {
      client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 10000, // 10秒连接超时
          reconnectStrategy: (retries) => Math.min(retries * 50, 500) // 重连策略
        }
      });
      
      await client.connect();
      console.log('Redis 连接成功');
    } catch (err) {
      console.error('Redis 连接失败:', err);
      return res.status(500).send(`❌ 数据库连接失败: ${err.message}`);
    }
    
    // 从 KV 读取数据
    async function readData() {
      try {
        const value = await client.get('checkin_data');
        if (value) {
          return JSON.parse(value);
        }
        return { checkins: [] };
      } catch (err) {
        console.error('读取数据失败:', err);
        return { checkins: [] };
      }
    }
    
    // 保存数据到 KV
    async function writeData(data) {
      try {
        await client.set('checkin_data', JSON.stringify(data, null, 2));
      } catch (err) {
        console.error('保存数据失败:', err);
        throw err;
      }
    }
    
    // 签到处理函数
    async function handleCheckin(userId, userName, groupId = 'default') {
      const data = await readData();
      const today = getTodayDate();
      const yesterday = getYesterdayDate();
      
      // 查找用户的所有签到记录
      let userRecords = data.checkins.filter(r => r.user_id === userId && r.group_id === groupId);
      
      // 检查今天是否已签到
      const todayRecord = userRecords.find(r => r.checkin_date === today);
      
      if (todayRecord) {
        // 计算排名
        const sortedUsers = [...new Set(data.checkins.map(r => r.user_id))]
          .map(uid => {
            const records = data.checkins.filter(r => r.user_id === uid && r.group_id === groupId);
            const latest = records.sort((a, b) => b.total_days - a.total_days)[0];
            return { userId: uid, userName: latest.user_name, totalDays: latest.total_days };
          })
          .sort((a, b) => b.totalDays - a.totalDays);
        
        const rank = sortedUsers.findIndex(u => u.userId === userId) + 1;
        
        return {
          success: true,
          alreadyCheckedIn: true,
          message: `${userName}，你今天已经签到过了！\n📅 已连续签到 ${todayRecord.total_days} 天\n🏆 当前排名第 ${rank} 名`
        };
      }
      
      // 检查昨天是否签到（用于计算连续天数）
      const yesterdayRecord = userRecords.find(r => r.checkin_date === yesterday);
      
      let totalDays = 1;
      if (yesterdayRecord) {
        totalDays = yesterdayRecord.total_days + 1;
      }
      
      // 插入签到记录
      data.checkins.push({
        user_id: userId,
        user_name: userName,
        group_id: groupId,
        checkin_date: today,
        total_days: totalDays,
        created_at: new Date().toISOString()
      });
      
      // 保存数据
      await writeData(data);
      
      // 计算排名
      const sortedUsers = [...new Set(data.checkins.map(r => r.user_id))]
        .map(uid => {
          const records = data.checkins.filter(r => r.user_id === uid && r.group_id === groupId);
          const latest = records.sort((a, b) => b.total_days - a.total_days)[0];
          return { userId: uid, userName: latest.user_name, totalDays: latest.total_days };
        })
        .sort((a, b) => b.totalDays - a.totalDays);
      
      const rank = sortedUsers.findIndex(u => u.userId === userId) + 1;
      
      return {
        success: true,
        alreadyCheckedIn: false,
        message: `✅ 签到成功！\n👤 ${userName}\n📅 已连续签到 ${totalDays} 天\n🏆 当前排名第 ${rank} 名`
      };
    }
    
    // 获取排行榜
    function getRanking(data, groupId = 'default', limit = 10) {
      const sortedUsers = [...new Set(data.checkins.map(r => r.user_id))]
        .map(uid => {
          const records = data.checkins.filter(r => r.user_id === uid && r.group_id === groupId);
          const latest = records.sort((a, b) => b.total_days - a.total_days)[0];
          return { 
            userName: latest.user_name, 
            totalDays: latest.total_days,
            lastCheckin: latest.checkin_date 
          };
        })
        .sort((a, b) => b.totalDays - a.totalDays)
        .slice(0, limit);
      
      return sortedUsers.map((item, index) => ({
        rank: index + 1,
        userName: item.userName,
        totalDays: item.totalDays,
        lastCheckin: item.lastCheckin
      }));
    }
    
    // 排行榜查询
    if (action === 'ranking') {
      const data = await readData();
      const ranking = getRanking(data, groupId || 'default');
      let message = '📊 签到排行榜 Top 10\n\n';
      ranking.forEach((item, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        message += `${medal} ${item.userName} - ${item.totalDays}天\n`;
      });
      if (ranking.length === 0) {
        message += '暂无签到记录';
      }
      await client.quit();
      return res.status(200).send(message);
    }
    
    // 签到功能
    if (!userId || !userName) {
      await client.quit();
      return res.status(200).send('❌ 缺少参数：userId 和 userName 为必填项');
    }
    
    if (msg !== '签到') {
      await client.quit();
      return res.status(200).send('💡 发送"签到"进行每日签到\n发送"排行榜"查看签到排行');
    }
    
    const result = await handleCheckin(userId, userName, groupId || 'default');
    await client.quit();
    return res.status(200).send(result.message);
    
  } catch (error) {
    console.error('签到API错误:', error);
    return res.status(500).send(`❌ 服务器错误: ${error.message}`);
  }
};
