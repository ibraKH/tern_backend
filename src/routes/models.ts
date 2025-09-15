import express, { Request, Response, NextFunction } from 'express';

const models = express.Router();

models.get("/", (req: Request, res: Response) => {
    res.send("Models route");
})

// 1. GET /models：获取所有可用模型列表（用于模型选择）
models.get("/", async (req: Request, res: Response) => {
  try {
    // 调用服务层方法获取所有模型
    const allModels = await getAllModels();
    // 返回模型列表
    res.json({ 
      message: 'All available models', 
      count: allModels.length,
      data: allModels 
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Error fetching models list', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// 2. GET /models/{name}：获取特定模型的详细信息（用于页面展示）
models.get("/:name", async (req: Request, res: Response) => {
  try {
    // 从URL参数中获取模型名称
    const modelName = req.params.name;
    
    // 调用服务层方法根据名称获取模型
    const model = await getModelByName(modelName);
    
    // 检查模型是否存在
    if (!model) {
      return res.status(404).json({ 
        message: `Model with name '${modelName}' not found` 
      });
    }
    
    // 返回模型详细信息
    res.json({ 
      message: `Details for model '${modelName}'`, 
      data: model 
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Error fetching model details', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});


export default models;

