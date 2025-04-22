const autorizacaoMiddleware = (rolesPermitidos) => (req, res, next) => {
    const usuarioRole = req.usuarioRole; // Obtém o role do usuário do token JWT

    // Verifica se o role do usuário está na lista de roles permitidos
    if (!rolesPermitidos.includes(usuarioRole)) {
        return res.status(403).json({ erro: 'Acesso negado' });
    }

    next(); // Permite o acesso
};

module.exports = autorizacaoMiddleware;