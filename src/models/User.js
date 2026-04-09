const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash',
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('VIEWER', 'ANALYST', 'ADMIN'),
        defaultValue: 'VIEWER',
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('ACTIVE', 'INACTIVE'),
        defaultValue: 'ACTIVE',
        allowNull: false,
      },
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
        field: 'failed_login_attempts',
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'locked_until',
      },
    },
    {
      tableName: 'user',
      paranoid: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
      defaultScope: {
        attributes: {
          exclude: ['passwordHash', 'failedLoginAttempts', 'lockedUntil', 'deleted_at'],
        },
      },
      scopes: {
        withPassword: {
          attributes: {},
        },
      },
    }
  );

  User.associate = (models) => {
    User.hasMany(models.FinancialRecord, { foreignKey: 'created_by', as: 'records' });
    User.hasMany(models.RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });
  };

  return User;
};
