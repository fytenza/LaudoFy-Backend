const express = require('express');
const exameController = require('../controllers/exameController');
const authMiddleware = require('../middleware/authMiddleware');
const autorizacaoMiddleware = require('../middleware/autorizacaoMiddleware');
const multer = require('multer')
const Exame = require('../models/Exame');
const { auditLog } = require('../middleware/auditMiddleware');

const router = express.Router();
const upload = multer()

// Rota para criar um exame (apenas técnicos e administradores)
router.post(
    '/',
    authMiddleware,
    autorizacaoMiddleware(['tecnico', 'admin', 'medico']),
    auditLog('create', 'Tentativa de criação de exame'), // Middleware para registrar a tentativa
    upload.single('arquivo'),
    exameController.validarExame,
    exameController.criarExame
);

// Rota para listar exames com paginação e filtros
router.get('/', authMiddleware, exameController.listarExames );

// Rota para listar exames para seleção
router.get('/selecao', authMiddleware, exameController.listarExamesParaSelecao );

// Rota para listar exames sem laudo
router.get('/sem-laudo', authMiddleware, exameController.listarExamesSemLaudo );

// Rota para obter um exame por ID (todos os usuários autenticados)
router.get('/:id', authMiddleware, exameController.obterExame);

router.get('/:id/download', authMiddleware, exameController.downloadArquivo);

// Rota para atualizar um exame (apenas técnicos e administradores)
router.put(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['tecnico', 'admin', 'medico']), // Apenas técnicos e administradores
    exameController.atualizarExame
);

// Rota para deletar um exame (apenas administradores)
router.delete(
    '/:id',
    authMiddleware,
    autorizacaoMiddleware(['admin']), // Apenas administradores
    exameController.deletarExame
);

module.exports = router;