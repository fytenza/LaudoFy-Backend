const express = require('express');
const pacienteController = require('../controllers/pacienteController');
const authMiddleware = require('../middleware/authMiddleware');
const { auditLog } = require('../middleware/auditMiddleware');

const router = express.Router();

// Rotas de Pacientes
router.post('/', 
    authMiddleware,
    auditLog('create', 'Tentativa de registro de paciente'),
    pacienteController.criarPaciente
);
router.get('/', authMiddleware, pacienteController.listarPacientes);
router.get('/:id', authMiddleware, pacienteController.obterPaciente);

router.put(
    '/:id', 
    authMiddleware,
    auditLog('update', 'Tentativa de atualização de paciente'), // Se você quiser registrar a tentativa
    pacienteController.atualizarPaciente
);

router.delete('/:id', authMiddleware, pacienteController.deletarPaciente);

module.exports = router;
