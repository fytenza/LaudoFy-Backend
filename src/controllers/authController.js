const Usuario = require('../models/Usuario');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const AuditLog = require('../models/AuditModel'); // Adicionado
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const sgTransport = require('@sendgrid/mail');
const { sendPasswordResetEmail } = require('../services/emailService');
const AuthService = require('../services/authService');
const axios = require('axios');

const secretKey = process.env.RECAPTCHA_SECRET_KEY;

// Gerar tokens (access token e refresh token)
const gerarTokens = (usuario) => {
    const accessToken = jwt.sign(
      { id: usuario._id, nome: usuario.nome, role: usuario.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
    return { accessToken, refreshToken, hashedRefreshToken };
  };

// Validação para email de recuperação
exports.validarEmail = [
    body('email').isEmail().withMessage('Email inválido')
];

// Validação para reset de senha
exports.validarResetSenha = [
    body('token').notEmpty().withMessage('Token é obrigatório'),
    body('senha').isLength({ min: 6 }).withMessage('A senha deve ter pelo menos 6 caracteres')
];

// Configuração do transporter de email (adicione suas credenciais)
const transporter = nodemailer.createTransport({
    service: 'gmail', // ou outro serviço
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Exporta a função gerarTokens
module.exports.gerarTokens = gerarTokens;

// Validações para registro de usuário
exports.validarRegistro = [
    body('nome').notEmpty().withMessage('O nome é obrigatório'),
    body('email').isEmail().withMessage('Email inválido'),
    body('senha').isLength({ min: 6 }).withMessage('A senha deve ter pelo menos 6 caracteres'),
    body('role').isIn(['medico', 'tecnico', 'admin']).withMessage('Role inválida'),
];

// Registrar um novo usuário
exports.registrar = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await AuditLog.create({
                userId: null,
                action: 'create_failed',
                description: 'Tentativa de registro falhou - validação',
                collectionName: 'usuarios',
                documentId: null,
                before: null,
                after: { email: req.body.email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({ erro: 'Credenciais inválidas' });
        }

        const { nome, email, senha, role } = req.body;

        const usuarioExistente = await Usuario.findOne({ email });
        if (usuarioExistente) {
            await AuditLog.create({
                userId: null,
                action: 'create_failed',
                description: `Tentativa de registro com email existente: ${email}`,
                collectionName: 'usuarios',
                documentId: null,
                before: null,
                after: { email: req.body.email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({ erro: 'Credenciais inválidas' });
        }

        const usuario = new Usuario({ nome, email, senha, role });
        await usuario.save();

        const { accessToken, refreshToken } = gerarTokens(usuario);
        const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
        usuario.refreshToken = hashedRefresh;
        await usuario.save();

        // Log de auditoria para registro bem-sucedido
        await AuditLog.create({
            userId: usuario._id,
            action: 'create',
            description: `Novo usuário registrado: ${email}`,
            collectionName: 'usuarios',
            documentId: usuario._id,
            before: null,
            after: usuario.toObject(),
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.status(201).json({ accessToken, refreshToken });
    } catch (err) {
        await AuditLog.create({
            userId: null,
            action: 'create_failed',
            description: `Erro ao registrar usuário: ${err.message}`,
            collectionName: 'usuarios',
            documentId: null,
            before: null,
            after: { email: req.body.email },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        return res.status(400).json({ erro: 'Credenciais inválidas' });
    }
};

// Validações para login de usuário
exports.validarLogin = [
    body('email').isEmail().withMessage('Email inválido'),
    body('senha').notEmpty().withMessage('A senha é obrigatória'),
];

// Login de usuário
// Auth Controller - login sem reCAPTCHA
exports.login = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await AuditLog.create({
                userId: null,
                action: 'login_failed',
                description: 'Tentativa de login falhou - validação',
                collectionName: 'auth',
                documentId: null,
                before: null,
                after: { email: req.body.email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({ erro: 'Requisição inválida. Verifique os dados enviados.' });
        }

        const { email, senha } = req.body;
        const usuario = await Usuario.findOne({ email });

        if (!usuario) {
            await AuditLog.create({
                userId: null,
                action: 'login_failed',
                description: `Tentativa de login com email não encontrado: ${email}`,
                collectionName: 'auth',
                documentId: null,
                before: null,
                after: { email: req.body.email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({ erro: 'Email enviado inválido' });
        }

        const senhaValida = await usuario.compararSenha(senha);
        console.log('Password comparison result:', senhaValida);  // Add this line
        if (!senhaValida) {
            await AuditLog.create({
                userId: usuario._id,
                action: 'login_failed',
                description: `Tentativa de login com senha inválida para: ${email}`,
                collectionName: 'auth',
                documentId: usuario._id,
                before: null,
                after: null,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({ erro: 'Senha invpalida' });
        }

        const { accessToken, refreshToken, hashedRefreshToken } = gerarTokens(usuario);
        usuario.refreshToken = hashedRefreshToken;
        await usuario.save();

        await AuditLog.create({
            userId: usuario._id,
            action: 'login',
            description: `Login bem-sucedido para: ${email}`,
            collectionName: 'auth',
            documentId: usuario._id,
            before: null,
            after: { accessToken, refreshToken },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.status(200).json({ accessToken });
    } catch (err) {
        await AuditLog.create({
            userId: null,
            action: 'login_failed',
            description: `Erro durante login: ${err.message}`,
            collectionName: 'auth',
            documentId: null,
            before: null,
            after: { email: req.body.email },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        return res.status(400).json({ erro: 'Credenciais inválidas' });
    }
};


// Obter novo access token usando o refresh token
exports.refreshToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;

        if (!refreshToken) {
            await AuditLog.create({
                userId: null,
                action: 'refresh_token',
                description: 'Refresh token não fornecido',
                collectionName: 'auth',
                documentId: null,
                before: null,
                after: { email: req.body.email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(400).json({ erro: 'Refresh token não fornecido' });
        }

        const hashedInput = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const usuario = await Usuario.findOne({ refreshToken: hashedInput });

        if (!usuario) {
            await AuditLog.create({
                userId: decoded.id || null,
                action: 'refresh_token',
                description: 'Refresh token inválido ou expirado',
                collectionName: 'auth',
                documentId: decoded.id || null,
                before: null,
                after: { email: req.body.email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ erro: 'Refresh token inválido' });
        }

        const accessToken = jwt.sign(
            { id: usuario._id, nome: usuario.nome, role: usuario.role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
          );

        await AuditLog.create({
            userId: usuario._id,
            action: 'refresh_token',
            description: 'Access token renovado com sucesso',
            collectionName: 'auth',
            documentId: usuario._id,
            before: null,
            after: { accessToken },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.status(200).json({ accessToken });
    } catch (err) {
        await AuditLog.create({
            userId: null,
            action: 'refresh_token',
            description: `Erro ao renovar token: ${err.message}`,
            collectionName: 'auth',
            documentId: null,
            before: null,
            after: { email: req.body.email },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });
        res.status(401).json({ erro: 'Refresh token inválido' });
    }
};

// Esqueci minha senha
exports.esqueciSenha = async (req, res) => {
    try {
        const { email } = req.body;

        // Validação básica
        if (!email) {
            return res.status(400).json({ erro: 'Email é obrigatório' });
        }

        // Usa o serviço para gerar o token
        const result = await AuthService.solicitarResetSenha(email);
        
        if (!result) {
            // Registra auditoria para email não encontrado (sem identificar)
            await AuditLog.create({
                action: 'forgot_password_request',
                description: `Solicitação para email não cadastrado: ${email}`,
                collectionName: 'auth',
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            return res.status(200).json({
                mensagem: 'Se o email existir, um link será enviado'
            });
        }

        // Envia o email com o token não-hashed
        await sendPasswordResetEmail(email, result.resetToken);

        // Registra auditoria
        await AuditLog.create({
            userId: result.usuario._id,
            action: 'forgot_password_request',
            description: `Solicitação de recuperação enviada para: ${email}`,
            collectionName: 'auth',
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.status(200).json({ 
            mensagem: 'Se o email estiver cadastrado, você receberá um link de recuperação' 
        });

    } catch (error) {
        console.error('Erro em esqueciSenha:', error);
        
        await AuditLog.create({
            action: 'forgot_password_failed',
            description: `Falha na solicitação: ${error.message}`,
            collectionName: 'auth',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });

        res.status(500).json({ 
            erro: 'Erro ao processar solicitação',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.resetarSenha = async (req, res) => {
    try {
        const { token, senha } = req.body;
        console.log('Token recebido:', req.body.token);
        console.log('Nova senha:', req.body.senha);

        // Validações básicas
        if (!token || !senha) {
            return res.status(400).json({ erro: 'Token e nova senha são obrigatórios' });
        }

        if (senha.length < 6) {
            return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres' });
        }

        // Usa o serviço para resetar a senha
        const usuario = await AuthService.resetarSenha(token, senha);

        // Registra auditoria
        await AuditLog.create({
            userId: usuario._id,
            action: 'password_reset_success',
            description: 'Senha redefinida com sucesso',
            collectionName: 'auth',
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.status(200).json({ 
            mensagem: 'Senha redefinida com sucesso',
            usuario: {
                id: usuario._id,
                email: usuario.email,
                nome: usuario.nome,
                role: usuario.role
            }
        });

    } catch (error) {
        console.error('Erro em resetarSenha:', error);
        
        // Registra falha específica
        let errorType = 'password_reset_failed';
        let description = `Falha ao redefinir senha: ${error.message}`;

        if (error.message.includes('Token inválido')) {
            errorType = 'password_reset_invalid_token';
            description = 'Tentativa com token inválido';
        }

        await AuditLog.create({
            action: errorType,
            description,
            collectionName: 'auth',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });

        const statusCode = error.message.includes('Token inválido') ? 400 : 500;
        
        res.status(statusCode).json({ 
            erro: error.message.includes('Token inválido') 
                ? error.message 
                : 'Erro ao redefinir senha',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Rota adicional para verificar token (útil para o frontend)
exports.verificarToken = async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).json({ erro: 'Token é obrigatório' });
        }

        const valido = await AuthService.verificarTokenReset(token);
        res.status(200).json({ valido });

    } catch (error) {
        console.error('Erro em verificarToken:', error);
        res.status(500).json({ 
            erro: 'Erro ao verificar token',
            detalhes: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};