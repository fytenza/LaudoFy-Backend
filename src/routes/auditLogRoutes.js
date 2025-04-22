const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const authMiddleware = require('../middleware/authMiddleware');
const autorizacaoMiddleware = require('../middleware/autorizacaoMiddleware');
const validacoes = require('../validations/auditLogValidations');

// Listar registros de auditoria
router.get(
    '/',
    authMiddleware,
    autorizacaoMiddleware(['admin']), // Apenas admin e auditor podem acessar
    validacoes.validarListagem,
    auditLogController.listarAuditoria
);

// Obter detalhes de um registro específico
router.get(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['admin']),
    validacoes.validarDetalhes,
    auditLogController.obterDetalhesAuditoria
);

module.exports = router;