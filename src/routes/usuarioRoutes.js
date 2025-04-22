const express = require('express');
const usuarioController = require('../controllers/usuarioController');
const authMiddleware = require('../middleware/authMiddleware');
const autorizacaoMiddleware = require('../middleware/autorizacaoMiddleware');
const { auditLog } = require('../middleware/auditMiddleware');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Limite de requisições para rotas críticas (proteção contra brute-force e abuso)
const createUpdateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 20,
    message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

// Criar usuário (apenas admin)
router.post(
    '/',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    createUpdateLimiter,
    auditLog('create', 'Tentativa de registro de usuário'),
    usuarioController.criarUsuario
);

// Listar todos os usuários (admin)
router.get(
    '/',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    usuarioController.listarUsuarios
);

// Obter um usuário específico (admin)
router.get(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    usuarioController.getUsuario
);

// Atualizar um usuário (admin)
router.put(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    createUpdateLimiter,
    auditLog('update', 'Tentativa de atualização de usuário'),
    usuarioController.atualizarUsuario
);

module.exports = router;