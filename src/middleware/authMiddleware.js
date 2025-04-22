const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    // Extrai o token do cabeçalho Authorization
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido' });
    }

    const token = authHeader.replace('Bearer ', '').trim();

    // Verifica e decodifica o token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Injeta os dados do usuário na requisição
    req.usuarioId = decoded.id;
    req.usuarioNome = decoded.nome;
    req.usuarioRole = decoded.role;

    next(); // Continua para a próxima função/middleware
  } catch (err) {
    logger.warn('Falha na autenticação JWT:', err.message);
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};

// Middleware de autorização por role
exports.verificarRole = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuarioRole)) {
      return res.status(403).json({ erro: 'Acesso negado' });
    }
    next();
  };
};

module.exports = authMiddleware;
