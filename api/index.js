const { VercelRequest, VercelResponse } = require('@vercel/node');

module.exports = async (req, res) => {
  const { msg, userId, userName } = req.query;
  
  // 参数验证
  if (!msg || !userId) {
    return res.status(400).json({ 
      success: false, 
      message: '缺少必要参数: msg, userId' 
    });
  }
  
  try {
    // 动态导入 Redis
    const { createClient } = await import('redis');
    
    // 连接 Redis
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = createClient({ url: redisUrl });
    
    await client.connect();
    
    // 生成唯一键
    const today = new Date().toISOString().split('T')[0];
    const key = `signin:${userId}:${today}`;
    
    // 检查是否已签到
    const hasSigned = await client.exists(key);
    
    if (hasSigned) {
      await client.disconnect();
      return res.status(200).json({
        success: true,
        message: '今天已经签过到了',
        user: userName || userId,
        date: today,
        status: 'already_signed'
      });
    }
    
    // 记录签到
    const signinData = {
      userId,
      userName: userName || userId,
      message: msg,
      date: today,
      timestamp: new Date().toISOString()
    };
    
    await client.set(key, JSON.stringify(signinData));
    
    // 添加到用户签到历史
    const historyKey = `signin_history:${userId}`;
    await client.lPush(historyKey, JSON.stringify(signinData));
    // 只保留最近100条记录
    await client.lTrim(historyKey, 0, 99);
    
    await client.disconnect();
    
    return res.status(200).json({
      success: true,
      message: '签到成功',
      user: userName || userId,
      date: today,
      status: 'success'
    });
    
  } catch (error) {
    console.error('Redis error:', error);
    return res.status(500).json({ 
      success: false, 
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
